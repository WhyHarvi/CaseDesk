import { AnimatePresence, motion, useAnimation, useMotionValue, useSpring, useTransform } from "framer-motion";
import { AlertCircle, ArrowLeft, Check, CheckCircle2, Eye, EyeOff, Loader2, Lock, Mail, MailCheck, ShieldCheck, UserRound } from "lucide-react";
import { useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import StarField from "../components/auth/StarField";
import { useAuth } from "../auth/AuthContext";
import { homePathForRole } from "../auth/AuthRoutes";
import api from "../services/api";

const CONTACT_EMAIL = "gsdhillon@chkimmigration.ca";
const BOOKING_SLUG = "chk-immigration-services-inc-421a";

const flipVariants = {
  enter: { rotateY: -90, opacity: 0 },
  center: { rotateY: 0, opacity: 1 },
  exit: { rotateY: 90, opacity: 0 },
};

const fadeUp = (delay) => ({
  initial: { opacity: 0, y: 16 },
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
  const controls = useAnimation();

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
      await api.post("/auth/forgot-password", { email: resetEmail.trim() });
      setResetStatus("sent");
    } catch (reason) {
      setResetStatus("idle");
      setResetError(reason.response?.data?.message || "Password recovery is temporarily unavailable. Please try again.");
    }
  }

  function openForgot() {
    setResetEmail(email);
    setResetStatus("idle");
    setResetError("");
    setMode("forgot");
  }

  const inputClass =
    "h-[50px] sm:h-11 w-full border-0 bg-transparent px-3 text-base text-white outline-none placeholder:text-white/40 sm:text-sm";

  return (
    <div className="relative h-[100dvh] w-full overflow-hidden bg-black font-body text-white">
      <StarField className="absolute inset-0 z-0 h-full w-full" />

      <div className="relative z-10 flex h-full flex-col">
        <header className="flex shrink-0 items-center justify-between px-5 py-3 md:px-[72px] md:py-4">
          <Link to="/login" className="flex items-center gap-2.5">
            <img src="/favicon_logo.png" alt="" className="h-6 w-6 rounded-lg md:h-7 md:w-7" />
            <span className="font-sans text-sm font-bold tracking-tight text-white md:text-[15px]">CHK Immigration Services</span>
          </Link>
          <div className="flex items-center gap-2">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              aria-label="Email us"
              className="liquid-glass-icon flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition hover:text-white md:h-10 md:w-10"
            >
              <Mail className="h-4 w-4" />
            </a>
            <Link
              to="/legal/privacy"
              aria-label="Privacy &amp; security"
              className="liquid-glass-icon flex h-8 w-8 items-center justify-center rounded-full text-white/80 transition hover:text-white md:h-10 md:w-10"
            >
              <ShieldCheck className="h-4 w-4" />
            </Link>
          </div>
        </header>

        <main className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 overflow-y-auto px-4 py-2 md:gap-4">
          <motion.div {...fadeUp(0)} className="hidden items-center gap-2.5 md:flex">
            <div className="flex -space-x-2">
              <span className="liquid-glass-icon flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <ShieldCheck className="h-3 w-3" />
              </span>
              <span className="liquid-glass-icon flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <Check className="h-3 w-3" />
              </span>
              <span className="liquid-glass-icon flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-black text-white/85">
                <UserRound className="h-3 w-3" />
              </span>
            </div>
            <span className="text-[12px] text-white/60">Secure sign-in to your client portal</span>
          </motion.div>

          <motion.h1
            {...fadeUp(0.08)}
            className="hidden max-w-3xl text-center font-sans text-4xl font-medium tracking-[-1.5px] md:block md:text-5xl md:tracking-[-2px] lg:text-6xl"
          >
            Every case. <span className="font-heading font-normal italic text-chk-light">One desk.</span>
          </motion.h1>

          <motion.p {...fadeUp(0.16)} className="mx-auto hidden max-w-[460px] text-center font-sans text-white/80 md:block md:text-base">
            Sign in to track your case, upload documents, and see your payments.
          </motion.p>

          <motion.div {...fadeUp(0.24)} className="w-full max-w-[400px] shrink-0 [perspective:1400px]">
            <motion.div
              ref={cardRef}
              onPointerMove={handlePointerMove}
              animate={controls}
              style={{ "--mx": mxPct, "--my": myPct }}
              className={`liquid-glass-card w-full p-6 md:p-7 ${
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
                      <div className="flex flex-col items-center py-10">
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 260, damping: 18 }}
                        >
                          <CheckCircle2 className="h-14 w-14 text-emerald-300" strokeWidth={1.5} />
                        </motion.span>
                        <p className="mt-4 text-lg text-white/90">Signed in</p>
                      </div>
                    ) : (
                      <>
                        <h2 className="login-title !text-[clamp(24px,3vw,30px)]">Sign in</h2>
                        <p className="mb-5 mt-1 text-center text-sm text-white/60">Access your CHK Immigration Services client portal</p>

                        <form onSubmit={submit} className="space-y-3">
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
                            className="glass-button-primary flex h-[50px] w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80 sm:h-11"
                          >
                            {status === "submitting" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Sign in"}
                          </motion.button>
                        </form>

                        <p className="mt-4 text-center text-xs text-white/50">
                          New client?{" "}
                          <Link to={`/book/${BOOKING_SLUG}`} className="font-medium text-white/80 underline underline-offset-2 transition hover:text-white">
                            Book a consultation
                          </Link>
                        </p>

                        <div className="mt-4 flex items-center justify-center gap-2 border-t border-white/10 pt-3 text-[11px] text-white/50">
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
                      <div className="flex flex-col items-center py-8 text-center">
                        <motion.span
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          transition={{ type: "spring", stiffness: 260, damping: 18 }}
                        >
                          <MailCheck className="h-14 w-14 text-emerald-300" strokeWidth={1.5} />
                        </motion.span>
                        <p className="mt-4 text-lg text-white/90">Check your inbox</p>
                        <p className="mt-2 max-w-[280px] text-sm text-white/60">
                          If an account matches that email, a secure recovery link will arrive shortly.
                        </p>
                        <button
                          type="button"
                          onClick={() => setMode("login")}
                          className="mt-7 flex items-center gap-1.5 text-xs text-white/50 transition hover:text-white/80"
                        >
                          <ArrowLeft className="h-3.5 w-3.5" /> Back to sign in
                        </button>
                      </div>
                    ) : (
                      <>
                        <h2 className="login-title !text-[clamp(24px,3vw,30px)]">Reset password</h2>
                        <p className="mb-5 mt-1 text-center text-sm text-white/60">We’ll email you a secure recovery link</p>

                        <form onSubmit={submitReset} className="space-y-3">
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
                            className="glass-button-primary flex h-[50px] w-full items-center justify-center rounded-full text-sm font-semibold disabled:opacity-80 sm:h-11"
                          >
                            {resetStatus === "submitting" ? <Loader2 className="h-5 w-5 animate-spin" /> : "Send recovery link"}
                          </motion.button>
                        </form>

                        <p className="mt-5 text-center text-xs text-white/50">
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
        </main>

        <footer className="flex shrink-0 flex-col items-center gap-1.5 px-5 py-2.5 text-center font-sans text-[11px] text-white/45 md:flex-row md:justify-between md:px-[72px] md:py-3 md:text-xs">
          <p>© {new Date().getFullYear()} CHK Immigration Services Inc.</p>
          <nav aria-label="Legal" className="flex items-center gap-3">
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
    </div>
  );
}
