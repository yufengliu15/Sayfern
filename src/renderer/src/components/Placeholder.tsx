import type { ReactNode } from "react";
import type { IconName } from "./icons";
import { Icon } from "./icons";

/** Temporary screen body used by screens that another agent is building. */
export function Placeholder({ eyebrow, title, icon, children, action }: { eyebrow: string; title: string; icon: IconName; children?: ReactNode; action?: ReactNode }) {
  return (
    <main className="main">
      <header className="hdr drag" />
      <div className="placeholder">
        <span className="ph-i">
          <Icon name={icon} size={26} />
        </span>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        {children && <p className="muted ph-p">{children}</p>}
        {action}
      </div>
    </main>
  );
}
