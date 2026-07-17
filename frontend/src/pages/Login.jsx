import { AnimatePresence, motion, useAnimation, useMotionValue, useSpring, useTransform } from "framer-motion";
import { AlertCircle, ArrowLeft, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, MailCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePathForRole } from "../auth/AuthRoutes";
import { requireSupabase } from "../services/supabase";

const VIDEO_SRC = "/login_animation.mp4";

const flipVariants = {
  enter: { rotateY: -90, opacity: 0 },
  center: { rotateY: 0, opacity: 1 },
  exit: { rotateY: 90, opacity: 0 },
};

export default function Login() {
  const { signIn, isAuthenticated, role, accountError } = useAuth();
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

  if (isAuthenticated && status !== "success") return <Navigate to={homePathForRole(role)} replace />;

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
        : homePathForRole(identity.membership.role);
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
    "h-12 w-full border-0 bg-transparent px-3 text-base text-white outline-none placeholder:text-white/40 sm:text-sm";

  return (
    <div className="relative min-h-[100dvh] w-full overflow-hidden bg-black font-body">
      <video
        ref={videoRef}
        muted
        playsInline
        preload="auto"
        onLoadedMetadata={handleVideoReady}
        onCanPlay={handleVideoReady}
        src={VIDEO_SRC}
        className="fixed inset-0 h-full w-full object-cover"
      />
      <div className="fixed inset-0 bg-gradient-to-b from-black/30 via-black/10 to-black/55" />

      <div className="relative z-10 flex min-h-[100dvh] w-full flex-col items-center justify-center px-4 py-10">
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="login-title mb-7 !text-[clamp(28px,3.4vw,42px)] text-white/95 drop-shadow-[0_4px_24px_rgba(0,0,0,0.45)]"
        >
          Every case. One desk.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 24, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.7, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-[400px] [perspective:1400px]"
        >
          <motion.div
            ref={cardRef}
            onPointerMove={handlePointerMove}
            animate={controls}
            style={{ "--mx": mxPct, "--my": myPct }}
            className={`liquid-glass-card w-full p-8 md:p-10 ${
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
                      <img src="/favicon_logo.png" alt="CaseDesk" className="mx-auto h-12 w-12 rounded-2xl" />
                      <h1 className="login-title mt-5 !text-[clamp(30px,3.5vw,40px)]">Sign in</h1>
                      <p className="mb-8 mt-1 text-center text-sm text-white/60">Access your CaseDesk workspace</p>

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
                          className="glass-button-primary flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80"
                        >
                          {status === "submitting" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
                        </motion.button>
                      </form>

                      <p className="mt-6 text-center text-xs text-white/50">
                        <button type="button" onClick={openForgot} className="transition hover:text-white/80">
                          Forgot password?
                        </button>
                      </p>
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
                      <img src="/favicon_logo.png" alt="CaseDesk" className="mx-auto h-12 w-12 rounded-2xl" />
                      <h1 className="login-title mt-5 !text-[clamp(30px,3.5vw,40px)]">Reset password</h1>
                      <p className="mb-8 mt-1 text-center text-sm text-white/60">We’ll email you a secure recovery link</p>

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
                          className="glass-button-primary flex h-12 w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80"
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
    </div>
  );
}
