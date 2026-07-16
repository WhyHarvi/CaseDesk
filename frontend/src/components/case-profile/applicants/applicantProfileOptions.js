import { BriefcaseBusiness, Scale, UserRound, UsersRound } from "lucide-react";

export const applicantProfileOptions = [
  {
    value: "Applicant",
    label: "Applicant",
    description: "A person applying on this immigration file.",
    icon: UserRound,
  },
  {
    value: "Advisor",
    label: "Advisor",
    description: "An advice-only contact connected to the file.",
    icon: Scale,
  },
  {
    value: "Representative",
    label: "Representative",
    description: "An authorized representative or legal contact.",
    icon: BriefcaseBusiness,
  },
  {
    value: "Other Immigration Profile",
    label: "Other immigration profile",
    description: "Another person who needs a profile or case access.",
    icon: UsersRound,
  },
];

export function getProfileOption(value) {
  return applicantProfileOptions.find((option) => option.value === value) || applicantProfileOptions[0];
}
