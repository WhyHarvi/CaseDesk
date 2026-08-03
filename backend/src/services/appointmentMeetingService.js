import prisma from "./prisma/client.js";
import { logger } from "./logger.js";
import { processBookingMessageDeliveries, sendBookingMessages } from "./bookingNotificationService.js";
import { notifyUsers, schedulingCoordinatorRecipientIds } from "./notificationService.js";
import { createZoomMeeting, deleteZoomMeeting, updateZoomMeeting } from "./zoomService.js";
import { syncLeadConsultationFromAppointment } from "./leadConsultationAppointmentService.js";

const POLL_MS = 5_000;
let timer = null;
let running = false;

function revisionFor(appointment) {
  const updated = appointment?.updatedAt ? new Date(appointment.updatedAt).toISOString() : "";
  return `${appointment?.meetingMode || ""}:${new Date(appointment?.startsAt || 0).toISOString()}:${updated}`;
}

export function delayedZoomNotificationKind(job, appointment, attempts) {
  if (
    attempts >= 1
    && job?.payload?.confirmationReleased !== true
    && appointment?.status === "Scheduled"
    && appointment?.meetingMode === "Zoom"
    && ["booked", "rescheduled", "format_updated"].includes(job?.payload?.notifyKind)
  ) return job.payload.notifyKind;
  return null;
}

export async function enqueueAppointmentMeetingJob(db, {
  appointment,
  action = "SYNC",
  notifyKind = null,
  actorUserId = null,
  providerMeetingId = null,
  forceCreate = false,
  dedupeSuffix = "",
  amount = null,
  invoiceUrl = null,
}) {
  if (!appointment?.id || !appointment?.agencyId) return null;
  const dedupeKey = [
    "appointment-meeting",
    appointment.id,
    action,
    revisionFor(appointment),
    notifyKind || "none",
    dedupeSuffix || "default",
  ].join(":");
  const payload = {
    notifyKind,
    actorUserId,
    providerMeetingId,
    forceCreate,
    dedupeSuffix,
    ...(amount != null ? { amount } : {}),
    ...(invoiceUrl ? { invoiceUrl } : {}),
  };
  if (action === "SYNC") {
    // Only the newest pending revision should run. This is especially
    // important when a guest reschedules in the few seconds between
    // appointment creation and the worker's first pass: an older "booked"
    // job must not send a second, stale message.
    await db.appointmentMeetingJob.updateMany({
      where: {
        appointmentId: appointment.id,
        action: "SYNC",
        status: "pending",
        dedupeKey: { not: dedupeKey },
      },
      data: { status: "superseded", processedAt: new Date(), lockedAt: null, lastError: null },
    });
  }
  const job = await db.appointmentMeetingJob.upsert({
    where: { dedupeKey },
    create: {
      agencyId: appointment.agencyId,
      appointmentId: appointment.id,
      action,
      dedupeKey,
      payload,
    },
    update: {},
  });
  if (db === prisma) void processAppointmentMeetingJobs();
  return job;
}

async function markDone(jobId, status = "processed") {
  await prisma.appointmentMeetingJob.update({
    where: { id: jobId },
    data: { status, processedAt: new Date(), lockedAt: null, lastError: null },
  });
}

async function alertMeetingSyncFailure(job, appointment, error, { exhausted = true } = {}) {
  const mode = appointment?.meetingMode === "Zoom" ? "Zoom" : "video";
  await notifyUsers({
    agencyId: job.agencyId,
    recipientIds: await schedulingCoordinatorRecipientIds(job.agencyId),
    type: "appointment.meeting_sync_failed",
    category: "appointments",
    title: exhausted ? `${mode} meeting synchronization failed` : `${mode} meeting link is delayed`,
    body: exhausted
      ? `${appointment?.subject || "Appointment"} · ${appointment?.referenceCode || appointment?.id || job.appointmentId}. ${String(error.message || error).slice(0, 300)}`
      : `${appointment?.subject || "Appointment"} · ${appointment?.referenceCode || appointment?.id || job.appointmentId}. CaseDesk is retrying automatically; verify the Zoom connection if the link remains unavailable. ${String(error.message || error).slice(0, 220)}`,
    severity: exhausted ? "critical" : "warning",
    entityType: "appointment",
    entityId: job.appointmentId,
    actionUrl: "/app/calendar",
    dedupeKey: `appointment:${job.appointmentId}:meeting-sync:${job.id}:${exhausted ? "failed" : "delayed"}`,
    channels: ["in_app"],
  }).catch(() => {});
}

export function appointmentFieldsAfterZoomDeletion(appointment) {
  const isActiveJitsi = appointment?.status === "Scheduled" && appointment?.meetingMode === "Online";
  return {
    meetingUrl: isActiveJitsi ? appointment.meetingUrl : null,
    meetingProvider: isActiveJitsi ? "Jitsi" : null,
    meetingProviderId: null,
    meetingProviderHostId: null,
    meetingSyncStatus: isActiveJitsi ? "Ready" : "NotRequired",
    meetingSyncError: null,
  };
}

async function processDelete(job, appointment) {
  const meetingId = String(job.payload?.providerMeetingId || appointment?.meetingProviderId || "");
  if (meetingId) await deleteZoomMeeting(job.agencyId, meetingId);
  if (appointment && (appointment.status !== "Scheduled" || appointment.meetingMode !== "Zoom")) {
    const cleaned = await prisma.appointment.update({
      where: { id: appointment.id },
      // A mode change from Zoom to Jitsi creates its replacement URL
      // before this asynchronous Zoom deletion runs. Preserve that URL.
      data: appointmentFieldsAfterZoomDeletion(appointment),
    });
    await syncLeadConsultationFromAppointment(prisma, cleaned);
  }
  await markDone(job.id);
}

async function processSync(job, appointment) {
  if (!appointment || appointment.status !== "Scheduled" || appointment.meetingMode !== "Zoom") {
    await markDone(job.id, "ignored");
    return;
  }
  const newerJob = await prisma.appointmentMeetingJob.findFirst({
    where: {
      appointmentId: appointment.id,
      action: "SYNC",
      status: { in: ["pending", "processing"] },
      createdAt: { gt: job.createdAt },
    },
    select: { id: true },
  });
  if (newerJob) {
    await markDone(job.id, "superseded");
    return;
  }
  const [settings, mapping] = await Promise.all([
    prisma.bookingSettings.findUnique({ where: { agencyId: job.agencyId }, select: { timezone: true } }),
    appointment.assignedToId
      ? prisma.zoomHostMapping.findFirst({ where: { agencyId: job.agencyId, userId: appointment.assignedToId, status: "active" } })
      : null,
  ]);
  if (!mapping) throw new Error("The assigned consultant is not mapped to an active Zoom host.");

  // When Zoom succeeds but the following Appointment update fails, retain
  // the provider ID on the durable job. A retry then updates/reuses that
  // meeting instead of creating an orphan duplicate.
  let meetingId = job.payload?.createdProviderMeetingId
    || (job.payload?.forceCreate ? null : appointment.meetingProviderId);
  let joinUrl = job.payload?.createdJoinUrl || appointment.meetingUrl;
  let createdNewMeeting = Boolean(job.payload?.createdProviderMeetingId);
  if (meetingId && appointment.meetingProviderHostId && appointment.meetingProviderHostId !== mapping.zoomUserId) {
    await deleteZoomMeeting(job.agencyId, meetingId);
    meetingId = null;
    joinUrl = null;
    createdNewMeeting = false;
  }
  if (!meetingId) {
    const meeting = await createZoomMeeting(job.agencyId, {
      appointment,
      timezone: settings?.timezone,
    });
    meetingId = String(meeting.id);
    joinUrl = meeting.join_url;
    if (!joinUrl) throw new Error("Zoom created the meeting without a participant join link.");
    createdNewMeeting = true;
    const recoveredPayload = {
      ...(job.payload || {}),
      createdProviderMeetingId: meetingId,
      createdJoinUrl: joinUrl,
    };
    try {
      await prisma.appointmentMeetingJob.update({ where: { id: job.id }, data: { payload: recoveredPayload } });
      job.payload = recoveredPayload;
    } catch (error) {
      // If even the recovery marker cannot be persisted, remove the newly
      // created meeting immediately so the next retry cannot duplicate it.
      await deleteZoomMeeting(job.agencyId, meetingId).catch(() => {});
      throw error;
    }
  } else {
    const updatedExisting = await updateZoomMeeting(job.agencyId, {
      meetingId,
      appointment,
      timezone: settings?.timezone,
    });
    if (!updatedExisting) {
      const meeting = await createZoomMeeting(job.agencyId, {
        hostUserId: mapping.zoomUserId,
        appointment,
        timezone: settings?.timezone,
      });
      meetingId = String(meeting.id);
      joinUrl = meeting.join_url;
      if (!joinUrl) throw new Error("Zoom recreated the meeting without a participant join link.");
      createdNewMeeting = true;
      const recoveredPayload = {
        ...(job.payload || {}),
        createdProviderMeetingId: meetingId,
        createdJoinUrl: joinUrl,
      };
      try {
        await prisma.appointmentMeetingJob.update({ where: { id: job.id }, data: { payload: recoveredPayload } });
        job.payload = recoveredPayload;
      } catch (error) {
        await deleteZoomMeeting(job.agencyId, meetingId).catch(() => {});
        throw error;
      }
    }
  }

  const committed = await prisma.$transaction(async (tx) => {
    const saved = await tx.appointment.updateMany({
      where: {
        id: appointment.id,
        status: "Scheduled",
        meetingMode: "Zoom",
        updatedAt: appointment.updatedAt,
      },
      data: {
        meetingUrl: joinUrl,
        meetingProvider: "Zoom",
        meetingProviderId: meetingId,
        meetingProviderHostId: mapping.zoomUserId,
        meetingSyncStatus: "Ready",
        meetingSyncError: null,
      },
    });
    if (!saved.count) {
      return {
        saved: false,
        current: await tx.appointment.findUnique({ where: { id: appointment.id } }),
        notificationQueued: false,
      };
    }
    const updated = await tx.appointment.findUnique({
      where: { id: appointment.id },
      include: {
        client: { select: { fullName: true, email: true, phone: true } },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: true,
        agency: { select: { name: true, legalName: true } },
      },
    });
    if (!updated) return { saved: true, updated: null, notificationQueued: false };
    await syncLeadConsultationFromAppointment(tx, updated);
    if (!job.payload?.notifyKind) return { saved: true, updated, notificationQueued: false };

    const supersedingJob = await tx.appointmentMeetingJob.findFirst({
      where: {
        appointmentId: appointment.id,
        action: "SYNC",
        status: { in: ["pending", "processing"] },
        createdAt: { gt: job.createdAt },
      },
      select: { id: true },
    });
    const current = await tx.appointment.findFirst({
      where: {
        id: appointment.id,
        status: "Scheduled",
        meetingMode: "Zoom",
        meetingProviderId: meetingId,
      },
      include: {
        client: { select: { fullName: true, email: true, phone: true } },
        assignedTo: { select: { id: true, fullName: true } },
        sessionType: true,
        agency: { select: { name: true, legalName: true } },
      },
    });
    if (supersedingJob || !current) return { saved: true, updated, notificationQueued: false };
    await sendBookingMessages({
      agencyId: job.agencyId,
      appointment: current,
      kind: job.payload.notifyKind,
      actorUserId: job.payload.actorUserId || null,
      dedupeSuffix: job.payload.dedupeSuffix || "",
      db: tx,
      amount: job.payload?.amount ?? null,
      invoiceUrl: job.payload?.invoiceUrl || null,
    });
    return { saved: true, updated, notificationQueued: true };
  });
  if (!committed.saved) {
    // The appointment was cancelled, changed to another format, or moved
    // while the network request to Zoom was running. Never write stale
    // details back or notify the client from this obsolete revision.
    if (createdNewMeeting && meetingId) {
      const current = committed.current;
      const replacementWillReuseMeeting = current?.status === "Scheduled"
        && current.meetingMode === "Zoom"
        && current.meetingProviderId === meetingId;
      if (current && !replacementWillReuseMeeting) {
        await enqueueAppointmentMeetingJob(prisma, {
          appointment: current,
          action: "DELETE",
          providerMeetingId: meetingId,
          dedupeSuffix: `stale-sync-${job.id}`,
        });
      } else if (!current) {
        await deleteZoomMeeting(job.agencyId, meetingId).catch(() => {});
      }
    }
    await markDone(job.id, "superseded");
    return;
  }
  if (!committed.updated) {
    await markDone(job.id, "ignored");
    return;
  }
  if (committed.notificationQueued) void processBookingMessageDeliveries();
  await markDone(job.id);
}

export async function processAppointmentMeetingJobs() {
  if (running) return;
  running = true;
  try {
    const now = new Date();
    const jobs = await prisma.appointmentMeetingJob.findMany({
      where: {
        availableAt: { lte: now },
        OR: [
          { status: "pending" },
          { status: "processing", lockedAt: { lt: new Date(now.getTime() - 10 * 60_000) } },
        ],
      },
      orderBy: { availableAt: "asc" },
      take: 50,
    });
    for (const job of jobs) {
      const claimed = await prisma.appointmentMeetingJob.updateMany({
        where: { id: job.id, status: job.status, updatedAt: job.updatedAt },
        data: { status: "processing", lockedAt: new Date(), attempts: { increment: 1 } },
      });
      if (!claimed.count) continue;
      let appointment = null;
      try {
        appointment = await prisma.appointment.findUnique({
          where: { id: job.appointmentId },
          include: {
            client: { select: { fullName: true, email: true, phone: true } },
            assignedTo: { select: { id: true, fullName: true } },
            sessionType: true,
            agency: { select: { name: true, legalName: true } },
          },
        });
        if (job.action === "DELETE") await processDelete(job, appointment);
        else await processSync(job, appointment);
      } catch (error) {
        const attempts = job.attempts + 1;
        const exhausted = attempts >= job.maxAttempts;
        let nextPayload = job.payload;
        // Normally the first Zoom synchronization succeeds before the
        // booking/reschedule message is queued, so the client receives one
        // message containing the live join URL. If Zoom is unavailable,
        // never withhold the appointment confirmation itself: queue the
        // time/manage details now, then send the recovered link as a
        // separate update when a later retry succeeds.
        const delayedNotificationKind = delayedZoomNotificationKind(job, appointment, attempts);
        if (delayedNotificationKind) {
          nextPayload = {
            ...(job.payload || {}),
            notifyKind: "meeting_updated",
            confirmationReleased: true,
          };
        }
        const retryData = {
          status: exhausted ? "failed" : "pending",
          lockedAt: null,
          lastError: String(error.message || error).slice(0, 1000),
          availableAt: new Date(Date.now() + Math.min(30 * 60_000, 2 ** attempts * 15_000)),
          payload: nextPayload,
        };
        try {
          await prisma.$transaction(async (tx) => {
            if (delayedNotificationKind) {
              await sendBookingMessages({
                agencyId: job.agencyId,
                appointment,
                kind: delayedNotificationKind,
                actorUserId: job.payload.actorUserId || null,
                dedupeSuffix: job.payload.dedupeSuffix || "",
                db: tx,
              });
            }
            await tx.appointmentMeetingJob.update({
              where: { id: job.id },
              data: retryData,
            });
            if (appointment?.meetingMode === "Zoom") {
              await tx.appointment.update({
                where: { id: appointment.id },
                data: { meetingSyncStatus: exhausted ? "Failed" : "Retrying", meetingSyncError: String(error.message || error).slice(0, 500) },
              });
            }
          });
          if (delayedNotificationKind) void processBookingMessageDeliveries();
        } catch (persistenceError) {
          // Keep the original notification kind when the atomic write fails.
          // A recovered retry can then release the confirmation exactly once
          // instead of permanently withholding it after attempt one.
          logger.warn("appointment_meeting.delayed_confirmation_queue_failed", {
            agencyId: job.agencyId,
            appointmentId: job.appointmentId,
            jobId: job.id,
            reason: persistenceError.message,
          });
          await prisma.appointmentMeetingJob.update({
            where: { id: job.id },
            data: { ...retryData, payload: job.payload },
          }).catch(() => {});
          if (appointment?.meetingMode === "Zoom") {
            await prisma.appointment.update({
              where: { id: appointment.id },
              data: { meetingSyncStatus: exhausted ? "Failed" : "Retrying", meetingSyncError: String(error.message || error).slice(0, 500) },
            }).catch(() => {});
          }
        }
        logger.warn("appointment_meeting.sync_failed", {
          agencyId: job.agencyId,
          appointmentId: job.appointmentId,
          jobId: job.id,
          attempts,
          exhausted,
          reason: error.message,
        });
        if (attempts === 1 || exhausted) {
          await alertMeetingSyncFailure(job, appointment, error, { exhausted });
        }
      }
    }
  } finally {
    running = false;
  }
}

export function startAppointmentMeetingWorker() {
  if (timer) return;
  timer = setInterval(() => {
    void processAppointmentMeetingJobs().catch((error) => logger.warn("appointment_meeting.worker_failed", { reason: error.message }));
  }, POLL_MS);
  void processAppointmentMeetingJobs().catch((error) => logger.warn("appointment_meeting.worker_failed", { reason: error.message }));
  if (timer.unref) timer.unref();
}

export function stopAppointmentMeetingWorker() {
  if (timer) clearInterval(timer);
  timer = null;
}
