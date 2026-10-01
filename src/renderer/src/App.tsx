import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { WordPopoverHost } from "./components/WordPopover";
import { AppProvider, useApp } from "./context";
import { navigate, parseRoute, useRoute, type Route } from "./router";
import { CustomizeScreen } from "./screens/Customize";
import { GrammarScreen } from "./screens/Grammar";
import { LibraryScreen } from "./screens/Library";
import { OnboardingScreen } from "./screens/Onboarding";
import { ProgressScreen } from "./screens/Progress";
import { ReaderScreen } from "./screens/Reader";
import { SessionScreen } from "./screens/Session";
import { SettingsScreen } from "./screens/Settings";
import { TodayScreen } from "./screens/Today";

export function App() {
  return (
    <AppProvider fallback={<div className="app" />}>
      <Shell />
      <WordPopoverHost />
    </AppProvider>
  );
}

const NAV_KEYS: Record<string, Route> = { "1": "today", "2": "library", "3": "grammar", "4": "progress" };

function Shell() {
  const app = useApp();
  const route = parseRoute(useRoute());
  const { language } = app;

  // F-10: ⌘N new session, ⌘1..4 navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
      if (e.key.toLowerCase() === "n") {
        e.preventDefault();
        void app.startSession();
      } else if (NAV_KEYS[e.key]) {
        e.preventDefault();
        navigate(NAV_KEYS[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [app]);

  if (route.name === "onboarding") {
    return (
      <div className="app">
        <OnboardingScreen language={language} navigate={navigate} />
      </div>
    );
  }

  let screen;
  switch (route.name) {
    case "session":
      screen = <SessionScreen key={route.id} id={route.id} language={language} navigate={navigate} />;
      break;
    case "library":
      screen = <LibraryScreen language={language} navigate={navigate} />;
      break;
    case "reader":
      screen = <ReaderScreen key={route.docId} docId={route.docId} paragraph={route.paragraph} language={language} navigate={navigate} />;
      break;
    case "grammar":
      screen = <GrammarScreen key={language} grammarId={route.grammarId} language={language} navigate={navigate} />;
      break;
    case "progress":
      screen = <ProgressScreen language={language} navigate={navigate} />;
      break;
    case "settings":
      screen = <SettingsScreen tab={route.tab} language={language} navigate={navigate} />;
      break;
    case "customize":
      screen = <CustomizeScreen language={language} navigate={navigate} />;
      break;
    default:
      screen = <TodayScreen key={language} language={language} navigate={navigate} />;
  }

  return (
    <div className="app">
      <Sidebar route={route} />
      {screen}
    </div>
  );
}
