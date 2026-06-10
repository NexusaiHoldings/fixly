export type NavLink = {
  label: string;
  href: string;
};

export type NavGroup = {
  label: string;
  links: NavLink[];
};

export type NavConfig = {
  primary: NavLink[];
  groups: NavGroup[];
};

export const NAV_CONFIG: NavConfig = {
  primary: [
    { label: "Home", href: "/" },
    { label: "Book a Repair", href: "/book" },
    { label: "My Jobs", href: "/jobs" },
  ],
  groups: [
    {
      label: "Tradesperson",
      links: [
        { label: "Jobs", href: "/tradesperson/jobs" },
        { label: "Earnings", href: "/tradesperson/earnings" },
        { label: "Onboarding", href: "/tradesperson/onboard" },
      ],
    },
    {
      label: "Operations",
      links: [
        { label: "Jobs", href: "/admin/jobs" },
        { label: "Credential Review", href: "/admin/credentials" },
      ],
    },
  ],
};
