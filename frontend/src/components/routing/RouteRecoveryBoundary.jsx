import { Component } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";

export default class RouteRecoveryBoundary extends Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, details) {
    console.error("CaseDesk page rendering failed", error, details);
  }

  retry = () => {
    this.setState({ error: null });
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <section className="w-full max-w-md rounded-[2rem] border border-white bg-white p-7 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-700">
            <AlertTriangle className="h-5 w-5" />
          </span>
          <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">
            This page did not open correctly
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">
            Your work is safe. Try opening the page again, or refresh CaseDesk
            if the interruption continues.
          </p>
          <div className="mt-6 flex justify-center gap-2">
            <button
              type="button"
              onClick={this.retry}
              className="rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              Try again
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center gap-2 rounded-full bg-slate-950 px-4 py-2.5 text-sm font-semibold text-white"
            >
              <RotateCcw className="h-4 w-4" />
              Refresh CaseDesk
            </button>
          </div>
        </section>
      </div>
    );
  }
}
