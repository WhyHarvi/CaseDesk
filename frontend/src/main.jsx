import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, useLocation } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import "./index.css";
import faviconPng from "./assets/favicon_logo.png";
import { AuthProvider } from "./auth/AuthContext";
import { NotificationProvider } from "./components/notifications/NotificationProvider";
import NotificationPanel from "./components/notifications/NotificationPanel";
import CaseLifecycleModal from "./components/cases/CaseLifecycleModal";
import { queryClient } from "./services/queryClient";
import RouteRecoveryBoundary from "./components/routing/RouteRecoveryBoundary";
import { captureSupportFailure } from "./services/supportCapture";
import SupportCaptureNotice from "./components/support/SupportCaptureNotice";

function RoutedApplication() {
  const location = useLocation();

  return (
    <>
      <RouteRecoveryBoundary key={location.pathname} routeKey={location.pathname}>
        <AppRoutes />
      </RouteRecoveryBoundary>
      <SupportCaptureNotice />
    </>
  );
}

function AppShell() {
  useEffect(() => {
    const onError = (event) => void captureSupportFailure({ code: "PAGE_ERROR", message: event.message || event.error?.message });
    const onRejection = (event) => void captureSupportFailure({ code: "UNHANDLED_REJECTION", message: event.reason?.message || String(event.reason || "Unexpected application error") });
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    const iconLinks = [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=5" },
      { rel: "icon", type: "image/png", href: `${faviconPng}?v=5` },
      { rel: "shortcut icon", href: "/favicon.ico?v=5" },
      // A proper 180x180 icon, not the 64x64 favicon — iOS renders this
      // full-size on the home screen once a client adds the portal, and a
      // small source image just looks blurry scaled up.
      { rel: "apple-touch-icon", href: "/icons/icon-180.png?v=5" },
    ];

    document
      .querySelectorAll(
        "link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']",
      )
      .forEach((node) => node.remove());

    iconLinks.forEach(({ rel, type, href }) => {
      const link = document.createElement("link");
      link.rel = rel;
      if (type) {
        link.type = type;
      }
      link.href = href;
      document.head.appendChild(link);
    });
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Push/install still degrade gracefully without it — nothing in the
      // rest of the app depends on the service worker being present.
    });
  }, []);

  return (
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NotificationProvider>
            <RoutedApplication />
            <NotificationPanel />
            <CaseLifecycleModal />
          </NotificationProvider>
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>,
);
