import React, { useEffect } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import AppRoutes from "./routes/AppRoutes";
import "./index.css";
import faviconPng from "./assets/favicon_logo.png";
import { AuthProvider } from "./auth/AuthContext";
import { NotificationProvider } from "./components/notifications/NotificationProvider";
import NotificationPanel from "./components/notifications/NotificationPanel";

function AppShell() {
  useEffect(() => {
    const iconLinks = [
      { rel: "icon", type: "image/x-icon", href: "/favicon.ico?v=5" },
      { rel: "icon", type: "image/png", href: `${faviconPng}?v=5` },
      { rel: "shortcut icon", href: "/favicon.ico?v=5" },
      { rel: "apple-touch-icon", href: `${faviconPng}?v=5` },
    ];

    document
      .querySelectorAll("link[rel='icon'], link[rel='shortcut icon'], link[rel='apple-touch-icon']")
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

  return (
    <BrowserRouter>
      <AuthProvider>
        <NotificationProvider>
          <AppRoutes />
          <NotificationPanel />
        </NotificationProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AppShell />
  </React.StrictMode>
);
