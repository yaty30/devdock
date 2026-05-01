import type { ReactNode } from "react";

type PanelProps = {
  title: string;
  titleMeta?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({
  title,
  titleMeta,
  action,
  children,
  className = "",
}: PanelProps): JSX.Element {
  return (
    <section className={`panel ${className}`}>
      <div className="panel-header">
        <div className="panel-title-group">
          {title ? <h2>{title}</h2> : null}
          {titleMeta}
        </div>
        {action ? <div className="panel-action">{action}</div> : null}
      </div>
      {children}
    </section>
  );
}
