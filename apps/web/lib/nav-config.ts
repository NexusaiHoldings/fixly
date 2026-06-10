export const NAV_CONFIG = {
  primary: [
    { label: "Book a Repair", href: "/book" },
    { label: "My Jobs", href: "/jobs" },
  ],
  groups: [
    {
      label: "Tradesperson",
      items: [
        { label: "Jobs", href: "/tradesperson/jobs" },
        { label: "Earnings", href: "/tradesperson/earnings" },
        { label: "Onboard", href: "/tradesperson/onboard" },
      ],
    },
    {
      label: "Operations",
      items: [
        { label: "Jobs", href: "/admin/jobs" },
        { label: "Credentials", href: "/admin/credentials" },
      ],
    },
  ],
} as const;
