"use client";

// Top nav for the Tay UI shell.
//
// First-run UX: we always hide the nav on `/setup`. The wizard is a
// pre-configured flow with its own focused layout; surfacing post-setup
// destinations next to it would be a UX smell ("can I click Dashboard
// before I finish setup?"). Once the wizard is done, the post-redirect
// pages all carry the nav. Simple, explicit, and avoids needing to wire
// nav state through to a server-rendered prop just for one page's chrome.

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = { href: string; label: string };

const ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard" },
  { href: "/draft", label: "Draft" },
  { href: "/queue", label: "Queue" },
  { href: "/audit", label: "Audit" },
  { href: "/setup", label: "Setup" },
  { href: "/settings", label: "Settings" },
];

export function Nav() {
  const pathname = usePathname() ?? "/";

  // Suppress nav on the setup wizard. See header comment.
  if (pathname.startsWith("/setup")) return null;

  return (
    <header className="border-b border-gray-200 bg-white">
      <nav className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <Link
          href="/"
          className="text-base font-semibold tracking-tight text-gray-900"
        >
          Tay
        </Link>
        <ul className="flex items-center gap-1 text-sm">
          {ITEMS.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    active
                      ? "rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white"
                      : "rounded-md px-3 py-1.5 text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                  }
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
