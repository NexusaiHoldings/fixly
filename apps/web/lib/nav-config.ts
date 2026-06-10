export interface NavItem {
  href: string;
  label: string;
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

export interface NavConfig {
  primary: NavItem[];
  groups: NavGroup[];
}

export const NAV_CONFIG: NavConfig = {
  primary: [
    { href: "/book", label: "Book a Repair" },
    { href: "/jobs", label: "My Jobs" },
  ],
  groups: [
    {
      label: "Tradesperson",
      items: [
        { href: "/tradesperson/jobs", label: "Jobs" },
        { href: "/tradesperson/earnings", label: "Earnings" },
        { href: "/tradesperson/onboard", label: "Onboard" },
      ],
    },
    {
      label: "Admin",
      items: [
        { href: "/admin/jobs", label: "Jobs" },
        { href: "/admin/credentials", label: "Credentials" },
      ],
    },
  ],
};
