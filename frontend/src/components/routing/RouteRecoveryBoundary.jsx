import { Component, Fragment } from "react";
import { Loader2 } from "lucide-react";

const RECOVERY_PREFIX = "casedesk.route-recovery";
const RECOVERY_WINDOW_MS = 90_000;
const RECOVERY_GUARD_CLEAR_MS = 45_000;

function recoveryKey(routeKey) {
  return `${RECOVERY_PREFIX}:${routeKey || "application"}`;
}

function readRecoveryAttempt(key) {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) || "null");
    if (!value?.at || Date.now() - value.at > RECOVERY_WINDOW_MS) return null;
    return value;
  } catch {
    return null;
  }
}

function rememberRecoveryAttempt(key) {
  try {
    sessionStorage.setItem(key, JSON.stringify({ at: Date.now() }));
  } catch {
    // The in-memory guard still prevents a same-render retry loop.
  }
}

function clearRecoveryAttempt(key) {
  try {
    sessionStorage.removeItem(key);
  } catch {
    // Storage is only used to coordinate recovery across a reload.
  }
}

function reloadWithFreshAssets() {
  const url = new URL(window.location.href);
  url.searchParams.set("__casedesk_recover", Date.now().toString());
  window.location.replace(url.toString());
}

export default class RouteRecoveryBoundary extends Component {
  state = { error: null, recoveryVersion: 0, recovering: false, exhausted: false };

  softRetryAttempted = false;
  recoveryTimer = null;
  guardClearTimer = null;

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidMount() {
    this.scheduleGuardCleanup();
  }

  componentDidUpdate(previousProps, previousState) {
    if (previousState.error && !this.state.error) this.scheduleGuardCleanup();
  }

  componentWillUnmount() {
    if (this.recoveryTimer) window.clearTimeout(this.recoveryTimer);
    if (this.guardClearTimer) window.clearTimeout(this.guardClearTimer);
  }

  componentDidCatch(error, details) {
    console.error("CaseDesk page rendering failed", error, details);
    if (this.recoveryTimer) return;

    if (!this.softRetryAttempted) {
      this.softRetryAttempted = true;
      this.setState({ recovering: true });
      this.recoveryTimer = window.setTimeout(() => {
        this.recoveryTimer = null;
        this.setState((current) => ({
          error: null,
          recovering: false,
          recoveryVersion: current.recoveryVersion + 1,
        }));
      }, 180);
      return;
    }

    const key = recoveryKey(this.props.routeKey);
    if (!readRecoveryAttempt(key)) {
      rememberRecoveryAttempt(key);
      this.setState({ recovering: true });
      this.recoveryTimer = window.setTimeout(() => {
        reloadWithFreshAssets();
      }, 350);
      return;
    }

    this.setState({ recovering: false, exhausted: true });
  }

  scheduleGuardCleanup = () => {
    if (this.state.error) return;
    if (this.guardClearTimer) window.clearTimeout(this.guardClearTimer);
    this.guardClearTimer = window.setTimeout(() => {
      clearRecoveryAttempt(recoveryKey(this.props.routeKey));
      const url = new URL(window.location.href);
      if (url.searchParams.has("__casedesk_recover")) {
        url.searchParams.delete("__casedesk_recover");
        window.history.replaceState(window.history.state, "", url.toString());
      }
    }, RECOVERY_GUARD_CLEAR_MS);
  };

  render() {
    if (!this.state.error) {
      return (
        <Fragment key={this.state.recoveryVersion}>
          {this.props.children}
        </Fragment>
      );
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <section className="w-full max-w-md rounded-[2rem] border border-white bg-white p-7 text-center shadow-[0_24px_70px_rgba(15,23,42,0.12)]">
          {this.state.exhausted ? (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-50 text-lg font-semibold text-rose-700">
                !
              </span>
              <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">
                CaseDesk could not recover this page
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                Automatic recovery was attempted without entering a reload
                loop. You can safely open another section from a new tab while
                this page is investigated.
              </p>
            </>
          ) : (
            <>
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-700">
                <Loader2 className="h-5 w-5 animate-spin" />
              </span>
              <h1 className="mt-5 text-xl font-semibold tracking-tight text-slate-950">
                Recovering this page…
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-500">
                CaseDesk detected an interrupted page load and is repairing it
                automatically. Your current address will be preserved.
              </p>
            </>
          )}
        </section>
      </div>
    );
  }
}
