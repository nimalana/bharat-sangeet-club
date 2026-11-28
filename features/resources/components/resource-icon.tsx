export type ResourceIconName = "search" | "plus" | "folder" | "file" | "link" | "image" | "chevron" | "arrow" | "close" | "upload" | "grid" | "list" | "lock" | "external" | "refresh";

export function ResourceIcon({ name, size = 18 }: { name: ResourceIconName; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, "aria-hidden": true };
  const paths: Record<string, React.ReactNode> = {
    search: <><circle cx="10.8" cy="10.8" r="6.7" /><path d="m16 16 4.3 4.3" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    folder: <><path d="M3.4 6.8h6l1.8 2h9.4v8.7a1.7 1.7 0 0 1-1.7 1.7H5.1a1.7 1.7 0 0 1-1.7-1.7Z" /><path d="M3.4 6.8V5.6a1.3 1.3 0 0 1 1.3-1.3h4l1.8 2.5" /></>,
    file: <><path d="M6 3.8h8l4 4v12.4H6z" /><path d="M14 3.8v4h4M9 13h6M9 16.5h4" /></>,
    link: <><path d="M9.6 14.4 8 16a3.7 3.7 0 0 1-5.2-5.2l2.8-2.8a3.7 3.7 0 0 1 5.2 0" /><path d="m14.4 9.6 1.6-1.6a3.7 3.7 0 0 1 5.2 5.2l-2.8 2.8a3.7 3.7 0 0 1-5.2 0" /><path d="m8.5 15.5 7-7" /></>,
    image: <><rect x="3.5" y="4.5" width="17" height="15" rx="1.5" /><circle cx="8.2" cy="9.1" r="1.4" /><path d="m4.5 17 4.5-4.5 3.2 3.1 2.2-2.2 5.1 4.8" /></>,
    chevron: <path d="m8 10 4 4 4-4" />,
    arrow: <><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>,
    close: <><path d="m6 6 12 12M18 6 6 18" /></>,
    upload: <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>,
    grid: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><rect x="14" y="14" width="6" height="6" /></>,
    list: <><path d="M8 6h12M8 12h12M8 18h12" /><path d="M4 6h.1M4 12h.1M4 18h.1" /></>,
    lock: <><rect x="5" y="10" width="14" height="10" rx="1.5" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" /></>,
    external: <><path d="M14 5h5v5M19 5l-8 8" /><path d="M18 13v5a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" /></>,
    refresh: <><path d="M20 11a8 8 0 0 0-14.6-3L4 10" /><path d="M4 5v5h5" /><path d="M4 13a8 8 0 0 0 14.6 3L20 14" /><path d="M20 19v-5h-5" /></>,
  };
  return <svg {...common}>{paths[name]}</svg>;
}
