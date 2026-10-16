import { memo } from "react";

/**
 * Icons drawn as plain paths. Keeping them inline avoids an icon dependency and
 * lets every glyph share one stroke weight and cap style.
 */

export interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

function make(path: React.ReactNode, viewBox = "0 0 24 24") {
  const Component = memo(function Icon({ size = 17, className }: IconProps) {
    return (
      <svg {...base(size)} className={className} viewBox={viewBox}>
        {path}
      </svg>
    );
  });
  return Component;
}

export const IconPlus = make(
  <>
    <path d="M12 5v14" />
    <path d="M5 12h14" />
  </>,
);

export const IconMinus = make(<path d="M5 12h14" />);

export const IconReset = make(
  <>
    <path d="M4 11.5a8 8 0 1 1 1.8 6" />
    <path d="M4 5v5h5" />
  </>,
);

export const IconTrash = make(
  <>
    <path d="M4 7h16" />
    <path d="M9.5 7V5.2A1.2 1.2 0 0 1 10.7 4h2.6a1.2 1.2 0 0 1 1.2 1.2V7" />
    <path d="M6.5 7l.8 12.1A1.5 1.5 0 0 0 8.8 20.5h6.4a1.5 1.5 0 0 0 1.5-1.4L17.5 7" />
  </>,
);

export const IconCopy = make(
  <>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M15 6.5V6a1.5 1.5 0 0 0-1.5-1.5h-7A1.5 1.5 0 0 0 5 6v7a1.5 1.5 0 0 0 1.5 1.5H7" />
  </>,
);

export const IconArrowUp = make(<path d="M12 19V6" />);
export const IconArrowDown = make(<path d="M12 5v13" />);

export const IconSettings = make(
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3.5v2M12 18.5v2M20.5 12h-2M5.5 12h-2M18 6l-1.4 1.4M7.4 16.6 6 18M18 18l-1.4-1.4M7.4 7.4 6 6" />
  </>,
);

export const IconKeyboard = make(
  <>
    <rect x="3" y="6" width="18" height="12" rx="2" />
    <path d="M7 10h.01M11 10h.01M15 10h.01M8 14h8" />
  </>,
);

export const IconShare = make(
  <>
    <circle cx="17" cy="6" r="2.4" />
    <circle cx="6.5" cy="12" r="2.4" />
    <circle cx="17" cy="18" r="2.4" />
    <path d="M8.7 10.8l6.1-3.4M8.7 13.2l6.1 3.4" />
  </>,
);

export const IconFunction = make(
  <>
    <path d="M13.5 4.5c-1.8 0-2.6 1.4-2.9 3.2L9 19.5" />
    <path d="M8 8h5.5M7.4 14h4.4" />
    <path d="M17.5 9.5l3 5M20.5 9.5l-3 5" />
  </>,
);

export const IconSlider = make(
  <>
    <path d="M4 8h9M17 8h3M4 16h3M11 16h9" />
    <circle cx="15" cy="8" r="2.1" />
    <circle cx="9" cy="16" r="2.1" />
  </>,
);

export const IconPoint = make(
  <>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 3v3.2M12 17.8V21M3 12h3.2M17.8 12H21" />
  </>,
);

export const IconTable = make(
  <>
    <rect x="3.5" y="5" width="17" height="14" rx="2" />
    <path d="M3.5 9.6h17M9.5 9.6V19" />
  </>,
);

export const IconEye = make(
  <>
    <path d="M2.6 12S6.4 5.8 12 5.8 21.4 12 21.4 12 17.6 18.2 12 18.2 2.6 12 2.6 12Z" />
    <circle cx="12" cy="12" r="2.8" />
  </>,
);

export const IconEyeOff = make(
  <>
    <path d="M4 4.6 20 20" />
    <path d="M9.6 6.2A9.6 9.6 0 0 1 12 5.9c5.6 0 9.4 6.1 9.4 6.1a17 17 0 0 1-3.3 3.9" />
    <path d="M6.3 8.1A16.6 16.6 0 0 0 2.6 12S6.4 18.1 12 18.1c1.3 0 2.4-.3 3.4-.7" />
    <path d="M9.9 9.9a2.9 2.9 0 0 0 4.1 4.1" />
  </>,
);

export const IconUndo = make(
  <>
    <path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H8" />
    <path d="M4 9l4-4M4 9l4 4" />
  </>,
);

export const IconRedo = make(
  <>
    <path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H16" />
    <path d="M20 9l-4-4M20 9l-4 4" />
  </>,
);

export const IconClose = make(
  <>
    <path d="M6.5 6.5l11 11M17.5 6.5l-11 11" />
  </>,
);

export const IconCheck = make(<path d="M5 12.8 9.5 17 19 7" />);

export const IconDownload = make(
  <>
    <path d="M12 4v11" />
    <path d="M8 11.5 12 15.5 16 11.5" />
    <path d="M5 19h14" />
  </>,
);

export const IconUpload = make(
  <>
    <path d="M12 16V5" />
    <path d="M8 8.5 12 4.5 16 8.5" />
    <path d="M5 19h14" />
  </>,
);
export const IconPanelUp = make(
  <>
    <path d="M4.5 15.5 12 9l7.5 6.5" />
  </>,
);

export const IconPanelDown = make(
  <>
    <path d="M4.5 8.5 12 15l7.5-6.5" />
  </>,
);

export const IconList = make(
  <>
    <path d="M9 6.5h11M9 12h11M9 17.5h11" />
    <path d="M4.5 6.5h.01M4.5 12h.01M4.5 17.5h.01" />
  </>,
);
