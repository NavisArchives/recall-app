import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import { DisplayProvider } from "./lib/DisplayContext";
import { AuthProvider } from "./context/AuthContext";
import "./fonts.css";
import "./index.css";
// The workspace's three light palettes (058). Inert without a
// `data-ws-theme` attribute, which only the workspace shells set — the
// display and the public site never carry it.
import "./styles/workspace-themes.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/*
  The collapse guard, development only (M190).

  A dynamic import behind `import.meta.env.DEV`, so the module is dropped
  from the production bundle entirely — nothing a family runs ever loads it.
  It watches for elements that render at a fraction of the width they asked
  for: the class that put six 3px PIN cells on the live sign-in screen while
  every width check stayed green.
*/
if (import.meta.env.DEV) {
  void import("./lib/collapseWatch").then((m) => m.watchForCollapses());
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <DisplayProvider>
          <App />
          </DisplayProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
