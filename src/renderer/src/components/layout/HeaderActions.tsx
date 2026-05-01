import { useEffect, useRef, useState } from "react";
import { ChevronDown, Play, RotateCcw, Square } from "lucide-react";
import { buildProfiles } from "../../data/mockData";

export function HeaderActions({
  disabled = false,
}: {
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="header-actions">
      <ServiceControlGroup disabled={disabled} />
      <BuildActionsDropdown disabled={disabled} />
    </div>
  );
}

function BuildActionsDropdown({
  disabled = false,
}: {
  disabled?: boolean;
}): JSX.Element {
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [openMode, setOpenMode] = useState<"hover" | "click" | null>(null);
  const open = openMode !== null;

  useEffect(() => {
    if (openMode !== "click") {
      return undefined;
    }

    function closeOnOutsideClick(event: MouseEvent): void {
      if (!dropdownRef.current?.contains(event.target as Node)) {
        setOpenMode(null);
      }
    }

    document.addEventListener("pointerdown", closeOnOutsideClick);
    return () =>
      document.removeEventListener("pointerdown", closeOnOutsideClick);
  }, [openMode]);

  useEffect(() => {
    if (disabled) {
      setOpenMode(null);
    }
  }, [disabled]);

  return (
    <div
      className="build-dropdown"
      ref={dropdownRef}
      onMouseEnter={() => {
        if (!disabled && openMode !== "click") {
          setOpenMode("hover");
        }
      }}
      onMouseLeave={() => {
        if (openMode === "hover") {
          setOpenMode(null);
        }
      }}
    >
      <button
        className={`button primary build-dropdown-trigger${open ? " open" : ""}`}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() =>
          setOpenMode((current) => (current === "click" ? null : "click"))
        }
      >
        <Play size={15} />
        Run Build
        <ChevronDown size={16} />
      </button>

      <div
        className={`build-dropdown-popover${open ? " open" : ""}`}
        aria-hidden={!open}
      >
        <div className="build-dropdown-menu" role="menu">
          {buildProfiles.map((profile) => (
            <button
              type="button"
              role="menuitem"
              key={profile.buttonName}
              disabled={disabled}
              onClick={() => setOpenMode(null)}
            >
              <Play size={14} />
              <span>{profile.buttonName}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ServiceControlGroup({
  disabled = false,
}: {
  disabled?: boolean;
}): JSX.Element {
  return (
    <div className="service-controls" aria-label="Service controls">
      {["Frontend", "WildFly"].map((service) => (
        <div className="service-control-card" key={service}>
          <span>{service}</span>
          <div className="service-action-group">
            <button
              type="button"
              aria-label={`Start ${service}`}
              title={`Start ${service}`}
              disabled={disabled}
            >
              <Play size={14} />
            </button>
            <button
              type="button"
              aria-label={`Terminate ${service}`}
              title={`Terminate ${service}`}
              disabled={disabled}
            >
              <Square size={14} />
            </button>
            <button
              type="button"
              aria-label={`Restart ${service}`}
              title={`Restart ${service}`}
              disabled={disabled}
            >
              <RotateCcw size={14} />
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
