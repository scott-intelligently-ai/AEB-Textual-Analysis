"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, SVGProps } from "react";
import { DocumentsIcon, PaletteIcon, SettingsIcon, TermsIcon } from "./icons";
import { cx } from "./ui";

interface Item {
  href: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  /** Other path prefixes that belong to this section. */
  also?: string[];
}

const ITEMS: Item[] = [
  { href: "/", label: "Documents", icon: DocumentsIcon, also: ["/documents", "/uploads"] },
  { href: "/terms", label: "Terms", icon: TermsIcon },
  { href: "/tones", label: "Tones", icon: PaletteIcon },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function isActive(item: Item, pathname: string | null): boolean {
  if (pathname === null) return false;
  if (item.href === "/") {
    return pathname === "/" || (item.also ?? []).some((prefix) => pathname.startsWith(prefix));
  }
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function NavLinks({ pathname }: { pathname: string | null }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {ITEMS.map((item) => {
        const active = isActive(item, pathname);
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cx(
                "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
              )}
            >
              <item.icon className="size-4.5 shrink-0" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

export function Nav() {
  return <NavLinks pathname={usePathname()} />;
}
