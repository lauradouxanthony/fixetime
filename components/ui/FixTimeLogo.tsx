"use client";

type Props = {
  size?: "sm" | "md" | "lg";
  variant?: "dark" | "light";
};

export function FixTimeLogo({ size = "md", variant = "dark" }: Props) {
  const sizes = {
    sm: { box: "w-7 h-7", text: "text-base", letter: "text-sm" },
    md: { box: "w-9 h-9", text: "text-xl", letter: "text-base" },
    lg: { box: "w-12 h-12", text: "text-2xl", letter: "text-xl" },
  };
  const s = sizes[size];

  // light = on dark bg (violet), dark = on light bg (white)
  const boxBg    = variant === "light" ? "rgba(255,255,255,0.18)" : "rgb(79 70 229)";
  const boxBorder= variant === "light" ? "1.5px solid rgba(255,255,255,0.3)" : "none";
  const letterColor = "text-white"; // toujours blanc
  const textColor   = variant === "light" ? "#ffffff" : "rgb(30 41 59)";

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`${s.box} flex items-center justify-center rounded-xl flex-shrink-0`}
        style={{ background: boxBg, border: boxBorder }}
      >
        <span className={`${s.letter} ${letterColor} font-bold leading-none`}>F</span>
      </div>
      <span
        className={`${s.text} font-bold tracking-tight leading-none`}
        style={{ color: textColor }}
      >
        FixTime
      </span>
    </div>
  );
}
