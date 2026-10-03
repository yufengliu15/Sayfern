import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource/geist-mono/400.css";
import "@fontsource/noto-serif-sc/400.css";
import "@fontsource/noto-serif-sc/600.css";
import "@fontsource/noto-serif-jp/400.css";
import "@fontsource/noto-serif-jp/600.css";
import "./styles.css";
// Stage 2 screens keep their rules in their own files (same tokens as styles.css).
import "./styles/review.css";
import "./styles/quiz.css";
import "./styles/builder.css";
import "./styles/decks.css";
import "./styles/voice.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

async function boot() {
  // Outside Electron (plain browser dev server) there is no preload bridge: use the mock.
  if (!(window as Partial<Window>).sayfern) {
    const { createMockApi } = await import("./dev/mockApi");
    window.sayfern = createMockApi();
  }
  const { App } = await import("./App");
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot();
