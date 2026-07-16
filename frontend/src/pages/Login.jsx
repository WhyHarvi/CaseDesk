import { Eye, EyeOff, LockKeyhole, Mail } from "lucide-react";
import { useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { homePathForRole } from "../auth/AuthRoutes";
import logo from "../assets/logo.png";

export default function Login() {
  const { signIn, isAuthenticated, role, accountError } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  if (isAuthenticated) return <Navigate to={homePathForRole(role)} replace />;

  async function submit(event) {
    event.preventDefault(); setLoading(true); setError("");
    try {
      const identity = await signIn(email, password);
      navigate(identity.appUser.mustChangePassword ? "/change-password" : homePathForRole(identity.membership.role), { replace: true });
    } catch (reason) { setError(reason.message || "Unable to sign in."); }
    finally { setLoading(false); }
  }

  return (
    <main className="grid min-h-screen bg-[#eef4fa] lg:grid-cols-[1.05fr_.95fr]">
      <section className="hidden overflow-hidden bg-slate-950 p-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="flex items-center gap-3"><img src={logo} alt="" className="h-12 w-12 rounded-2xl bg-white object-cover" /><span className="text-xl font-semibold">CaseDesk</span></div>
        <div className="max-w-xl"><p className="text-sm font-semibold uppercase tracking-[.28em] text-sky-300">Your practice, in focus</p><h1 className="mt-5 text-5xl font-semibold leading-tight">Know exactly which client needs what today.</h1><p className="mt-6 text-lg leading-8 text-slate-300">Secure casework for immigration agencies, consultants, and their clients.</p></div>
        <p className="text-sm text-slate-500">One secure workspace. Clear access at every step.</p>
      </section>
      <section className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-md rounded-[2rem] border border-white bg-white/90 p-7 shadow-panel sm:p-10">
          <div className="flex items-center gap-3 lg:hidden"><img src={logo} alt="CaseDesk" className="h-11 w-11 rounded-xl object-cover" /><span className="text-lg font-semibold">CaseDesk</span></div>
          <h2 className="mt-8 text-3xl font-semibold text-slate-950 lg:mt-0">Welcome back</h2><p className="mt-2 text-sm text-slate-500">Sign in to continue to your CaseDesk workspace.</p>
          <form onSubmit={submit} className="mt-8 space-y-5">
            <label className="block"><span className="text-sm font-medium text-slate-700">Email or login ID</span><div className="mt-2 flex items-center rounded-2xl border border-slate-200 bg-white px-4 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100"><Mail className="h-5 w-5 text-slate-400" /><input autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className="h-13 w-full border-0 bg-transparent px-3 py-3.5 outline-none" placeholder="you@agency.ca" /></div></label>
            <label className="block"><span className="flex items-center justify-between text-sm font-medium text-slate-700"><span>Password</span><Link to="/auth/forgot-password" className="font-normal text-sky-700 hover:text-sky-800">Forgot password?</Link></span><div className="mt-2 flex items-center rounded-2xl border border-slate-200 bg-white px-4 focus-within:border-sky-400 focus-within:ring-4 focus-within:ring-sky-100"><LockKeyhole className="h-5 w-5 text-slate-400" /><input autoComplete="current-password" required type={showPassword ? "text" : "password"} value={password} onChange={(e) => setPassword(e.target.value)} className="h-13 w-full border-0 bg-transparent px-3 py-3.5 outline-none" placeholder="Enter your password" /><button type="button" onClick={() => setShowPassword((v) => !v)} className="p-1 text-slate-400 hover:text-slate-700" aria-label={showPassword ? "Hide password" : "Show password"}>{showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}</button></div></label>
            {(error || accountError) && <div role="alert" className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-700">{error || accountError}</div>}
            <button disabled={loading} className="flex w-full items-center justify-center rounded-2xl bg-sky-600 px-4 py-3.5 text-sm font-semibold text-white shadow-lg shadow-sky-200 transition hover:bg-sky-700 disabled:cursor-wait disabled:opacity-70">{loading ? "Signing in…" : "Sign in"}</button>
          </form>
          <p className="mt-7 text-center text-sm text-slate-500">New agency? <Link to="/register" className="font-semibold text-sky-700 hover:text-sky-800">Create a workspace</Link></p>
        </div>
      </section>
    </main>
  );
}
