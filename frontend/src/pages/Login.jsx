import { AnimatePresence, motion, useAnimation, useMotionValue, useSpring, useTransform } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, MailCheck, ShieldCheck, UserRound } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePathForRole } from "../auth/AuthRoutes";
import { requireSupabase } from "../services/supabase";

const VIDEO_SRC = "/login_animation.mp4";
const VIDEO_POSTER = "/login_animation_poster.jpg";
const CONTACT_EMAIL = "gsdhillon@chkimmigration.ca";

const flipVariants = {
  enter: { rotateY: -90, opacity: 0 },
  center: { rotateY: 0, opacity: 1 },
  exit: { rotateY: 90, opacity: 0 },
};

const fadeUp = (delay) => ({
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease: "easeOut" },
});

export default function Login() {
  const { signIn, isAuthenticated, role, membership, accountError } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [mode, setMode] = useState(searchParams.get("forgot") === "1" ? "forgot" : "login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [resetEmail, setResetEmail] = useState("");
  const [resetStatus, setResetStatus] = useState("idle");
  const [resetError, setResetError] = useState("");
  const cardRef = useRef(null);
  const resetTimerRef = useRef(null);
  const videoRef = useRef(null);
  const videoSegmentRef = useRef(null);
  const controls = useAnimation();

  // The clip is a baked boomerang: first half plays forward, second half is the
  // same motion reversed. Segments of it are played to fake direction control.
  function playVideoSegment(start, end) {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (start != null) video.currentTime = Math.min(Math.max(start, 0), video.duration);
    videoSegmentRef.current = { end };
    video.play().catch(() => {});
  }

  function handleVideoReady() {
    const video = videoRef.current;
    if (!video || video.dataset.started || !Number.isFinite(video.duration)) return;
    video.dataset.started = "1";
    playVideoSegment(0, video.duration / 2);
  }

  function playVideoReverse() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    const half = video.duration / 2;
    const current = video.currentTime;
    const start = current <= half ? video.duration - current : null;
    playVideoSegment(start, video.duration);
  }

  function replayVideoForward() {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    if (video.duration - video.currentTime < 0.1) playVideoSegment(0, video.duration / 2);
  }

  useEffect(() => {
    let frame;
    function tick() {
      const video = videoRef.current;
      const segment = videoSegmentRef.current;
      if (video && segment && video.currentTime >= segment.end - 0.03) {
        video.pause();
        videoSegmentRef.current = null;
      }
      frame = requestAnimationFrame(tick);
    }
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, []);

  const mx = useMotionValue(50);
  const my = useMotionValue(20);
  const mxSpring = useSpring(mx, { stiffness: 150, damping: 20 });
  const mySpring = useSpring(my, { stiffness: 150, damping: 20 });
  const mxPct = useTransform(mxSpring, (value) => `${value}%`);
  const myPct = useTransform(mySpring, (value) => `${value}%`);

  if (isAuthenticated && status !== "success") return <Navigate to={homePathForRole(role, membership?.permissions)} replace />;

  function handlePointerMove(event) {
    const rect = cardRef.current?.getBoundingClientRect();
    if (!rect) return;
    mx.set(((event.clientX - rect.left) / rect.width) * 100);
    my.set(((event.clientY - rect.top) / rect.height) * 100);
  }

  function failWith(message) {
    setErrorMessage(message);
    setStatus("error");
    playVideoReverse();
    controls.start({ x: [0, -12, 12, -8, 8, -4, 4, 0], transition: { duration: 0.5, ease: "easeInOut" } });
    window.clearTimeout(resetTimerRef.current);
    resetTimerRef.current = window.setTimeout(() => {
      setStatus((current) => (current === "error" ? "idle" : current));
    }, 1800);
  }

  async function submit(event) {
    event.preventDefault();
    if (status === "submitting" || status === "success") return;
    setStatus("submitting");
    setErrorMessage("");
    replayVideoForward();
    try {
      const identity = await signIn(email, password);
      if (!identity?.appUser || !identity?.membership) {
        failWith("Your account setup isn’t finished yet. Open the invitation link from your email to complete it.");
        return;
      }
      const destination = identity.appUser.mustChangePassword
        ? "/change-password"
        : homePathForRole(identity.membership.role, identity.membership.permissions);
      setStatus("success");
      window.setTimeout(() => navigate(destination, { replace: true }), 1200);
    } catch (reason) {
      failWith(reason.message || "Unable to sign in.");
    }
  }

  async function submitReset(event) {
    event.preventDefault();
    if (resetStatus === "submitting") return;
    setResetStatus("submitting");
    setResetError("");
    try {
      const redirectTo = `${window.location.origin}/auth/reset-password`;
      const { error: authError } = await requireSupabase().auth.resetPasswordForEmail(resetEmail.trim(), { redirectTo });
      if (authError) throw authError;
      setResetStatus("sent");
    } catch {
      setResetStatus("idle");
      setResetError("Password recovery is temporarily unavailable. Please try again.");
    }
  }

  function openForgot() {
    setResetEmail(email);
    setResetStatus("idle");
    setResetError("");
    setMode("forgot");
  }

  const inputClass =
    "h-[50px] sm:h-12 w-full border-0 bg-transparent px-3 text-base text-white outline-none placeholder:text-white/40 sm:text-sm";

  return (
    <div className="relative min-h-[100dvh] w-full overflow-x-hidden bg-black font-body text-white">
      <header className="fixed inset-x-0 top-0 z-50 flex items-center justify-between px-5 py-4 md:px-[72px]">
        <Link to="/login" className="flex items-center gap-2.5">
          <img src="/favicon_logo.png" alt="" className="h-7 w-7 rounded-lg" />
          <span className="font-sans text-[15px] font-bold tracking-tight text-white">CHK Immigration Services</span>
        </Link>
        <div className="flex items-center gap-2">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            aria-label="Email us"
            className="liquid-glass-icon flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:text-white md:h-10 md:w-10"
          >
            <Mail className="h-4 w-4" />
          </a>
          <Link
            to="/legal/privacy"
            aria-label="Privacy &amp; security"
            className="liquid-glass-icon flex h-9 w-9 items-center justify-center rounded-full text-white/80 transition hover:text-white md:h-10 md:w-10"
          >
            <ShieldCheck className="h-4 w-4" />
          </Link>
        </div>
      </header>

      <section className="relative flex min-h-[100dvh] w-full flex-col items-center justify-center overflow-hidden px-4 py-28 md:min-h-screen">
        <video
          ref={videoRef}
          muted
          playsInline
          preload="auto"
          poster={VIDEO_POSTER}
          onLoadedMetadata={handleVideoReady}
          onCanPlay={handleVideoReady}
          src={VIDEO_SRC}
          className="absolute inset-0 z-0 h-full w-full object-cover motion-reduce:hidden"
        />
        <div className="absolute inset-0 z-0 bg-black motion-reduce:block hidden" />
        <div className="absolute inset-0 z-0 bg-black/45 md:bg-black/40" />
        <div className="absolute inset-x-0 bottom-0 z-0 h-48 bg-gradient-to-t from-black to-transparent md:h-64" />

        <div className="relative z-10 flex w-full flex-col items-center">
          <motion.div {...fadeUp(0)} className="mb-6 flex items-center gap-2.5">
            <div className="flex -space-x-2">
              <span className="liquid-glass-icon flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <ShieldCheck className="h-3.5 w-3.5" />
              </span>
              <span className="liquid-glass-icon flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <Check className="h-3.5 w-3.5" />
              </span>
              <span className="liquid-glass-icon flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <UserRound className="h-3.5 w-3.5" />
              </span>
            </div>
            <span className="text-[13px] text-white/60">Secure sign-in to your client portal</span>
          </motion.div>

          <motion.h1
            {...fadeUp(0.11)}
            className="max-w-3xl text-center font-sans text-4xl font-medium tracking-[-1.5px] md:text-6xl md:tracking-[-2px] lg:text-7xl"
          >
            Every case. <span className="font-heading font-normal italic text-chk-light">One desk.</span>
          </motion.h1>

          <motion.p {...fadeUp(0.22)} className="mx-auto mt-4 max-w-[460px] text-center font-sans text-base text-white/80 md:text-lg">
            Sign in to track your case, upload documents, and see your payments.
          </motion.p>

          <motion.div {...fadeUp(0.33)} className="mt-8 w-full max-w-[400px] [perspective:1400px]">
            <motion.div
              ref={cardRef}
              onPointerMove={handlePointerMove}
              animate={controls}
              style={{ "--mx": mxPct, "--my": myPct }}
              className={`liquid-glass-card w-full p-6 md:p-8 ${
                status === "error" || resetError ? "state-error" : status === "success" || resetStatus === "sent" ? "state-success" : ""
              }`}
            >
              <AnimatePresence mode="wait" initial={false}>
                {mode === "login" ? (
                  <motion.div
                    key="login-face"
                    variants={flipVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {status === "success" ? (
                      <div className="flex flex-col items-center py-14">
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 260, damping: 18 }}
                        >
                          <CheckCircle2 className="h-16 w-16 text-emerald-300" strokeWidth={1.5} />
                        </motion.span>
                        <p className="mt-4 text-lg text-white/90">Signed in</p>
                      </div>
                    ) : (
                      <>
                        <h2 className="login-title !text-[clamp(26px,3vw,34px)]">Sign in</h2>
                        <p className="mb-7 mt-1 text-center text-sm text-white/60">Access your CHK Immigration Services client portal</p>

                        <form onSubmit={submit} className="space-y-4">
                          <div className="glass-input flex items-center rounded-full px-4">
                            <Mail className="h-4 w-4 shrink-0 text-white/50" />
                            <input
                              autoComplete="username"
                              required
                              value={email}
                              onChange={(e) => setEmail(e.target.value)}
                              placeholder="Email"
                              className={inputClass}
                            />
                          </div>

                          <div className={`glass-input flex items-center rounded-full px-4 ${status === "error" ? "input-error" : ""}`}>
                            <Lock className="h-4 w-4 shrink-0 text-white/50" />
                            <input
                              autoComplete="current-password"
                              required
                              type={showPassword ? "text" : "password"}
                              value={password}
                              onChange={(e) => setPassword(e.target.value)}
                              placeholder="Password"
                              className={inputClass}
                            />
                            <button
                              type="button"
                              onClick={() => setShowPassword((v) => !v)}
                              className="p-1 text-white/50 transition hover:text-white"
                              aria-label={showPassword ? "Hide password" : "Show password"}
                            >
                              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                            </button>
                          </div>

                          <div className="flex items-center justify-end px-1 text-xs text-white/50">
                            <button type="button" onClick={openForgot} className="transition hover:text-white/80">
                              Forgot password?
                            </button>
                          </div>

                          <AnimatePresence>
                            {status === "error" || accountError ? (
                              <motion.p
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                className="flex items-start gap-2 px-2 text-sm text-rose-300"
                              >
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{errorMessage || accountError}</span>
                              </motion.p>
                            ) : null}
                          </AnimatePresence>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            disabled={status === "submitting"}
                            className="glass-button-primary flex h-[52px] w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80 sm:h-12"
                          >
                            {status === "submitting" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
                          </motion.button>
                        </form>

                        <div className="my-6 flex items-center gap-3 text-[11px] uppercase tracking-[0.14em] text-white/35">
                          <span className="h-px flex-1 bg-white/10" />
                          or
                          <span className="h-px flex-1 bg-white/10" />
                        </div>

                        <a
                          href={`mailto:${CONTACT_EMAIL}`}
                          className="glass-button-secondary flex h-12 w-full items-center justify-center rounded-full text-sm font-medium transition hover:bg-white/10"
                        >
                          New client? Contact us
                        </a>

                        <div className="mt-6 flex items-center justify-center gap-2 border-t border-white/10 pt-4 text-[11px] text-white/50">
                          <span className="relative flex h-2 w-2 shrink-0">
                            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/60" />
                            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
                          </span>
                          <Link to="/legal/privacy" className="transition hover:text-white/80">
                            Privacy Policy
                          </Link>
                          <span aria-hidden="true" className="text-white/25">•</span>
                          <Link to="/legal/terms" className="transition hover:text-white/80">
                            Terms of Service
                          </Link>
                        </div>
                      </>
                    )}
                  </motion.div>
                ) : (
                  <motion.div
                    key="forgot-face"
                    variants={flipVariants}
                    initial="enter"
                    animate="center"
                    exit="exit"
                    transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
                    style={{ transformStyle: "preserve-3d" }}
                  >
                    {resetStatus === "sent" ? (
                      <div className="flex flex-col items-center py-10 text-center">
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 260, damping: 18 }}
                        >
                          <MailCheck className="h-16 w-16 text-emerald-300" strokeWidth={1.5} />
                        </motion.span>
                        <p className="mt-4 text-lg text-white/90">Check your inbox</p>
                        <p className="mt-2 max-w-[280px] text-sm text-white/60">
                          If an account matches that email, a secure recovery link will arrive shortly.
                        </p>
                        <button
                          type="button"
                          onClick={() => setMode("login")}
                          className="mt-8 flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white/80"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                        </button>
                      </div>
                    ) : (
                      <>
                        <h2 className="login-title !text-[clamp(26px,3vw,34px)]">Reset password</h2>
                        <p className="mb-7 mt-1 text-center text-sm text-white/60">We’ll email you a secure recovery link</p>

                        <form onSubmit={submitReset} className="space-y-4">
                          <div className={`glass-input flex items-center rounded-full px-4 ${resetError ? "input-error" : ""}`}>
                            <Mail className="h-4 w-4 shrink-0 text-white/50" />
                            <input
                              type="email"
                              autoComplete="email"
                              required
                              value={resetEmail}
                              onChange={(e) => setResetEmail(e.target.value)}
                              placeholder="Email"
                              className={inputClass}
                            />
                          </div>

                          <AnimatePresence>
                            {resetError ? (
                              <motion.p
                                initial={{ opacity: 0, y: -6 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -6 }}
                                className="flex items-start gap-2 px-2 text-sm text-rose-300"
                              >
                                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                                <span>{resetError}</span>
                              </motion.p>
                            ) : null}
                          </AnimatePresence>

                          <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.96 }}
                            disabled={resetStatus === "submitting"}
                            className="glass-button-primary flex h-[52px] w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80 sm:h-12"
                          >
                            {resetStatus === "submitting" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send recovery link"}
                          </motion.button>
                        </form>

                        <p className="mt-6 text-center text-xs text-white/50">
                          <button
                            type="button"
                            onClick={() => setMode("login")}
                            className="inline-flex items-center gap-1.5 transition hover:text-white/80"
                          >
                            <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                          </button>
                        </p>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          </motion.div>
        </div>
      </section>

      <footer className="relative z-10 flex flex-col items-center gap-3.5 border-t border-white/10 px-5 py-8 font-sans text-sm text-white/55 md:flex-row md:justify-between md:px-[72px] md:py-12">
        <p>© {new Date().getFullYear()} CHK Immigration Services Inc. All rights reserved.</p>
        <nav aria-label="Legal" className="flex items-center gap-4">
          <Link to="/legal/privacy" className="transition hover:text-white">
            Privacy
          </Link>
          <Link to="/legal/terms" className="transition hover:text-white">
            Terms
          </Link>
          <a href={`mailto:${CONTACT_EMAIL}`} className="transition hover:text-white">
            Contact
          </a>
        </nav>
      </footer>
    </div>
  );
}
