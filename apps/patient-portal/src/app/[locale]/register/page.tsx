import { unstable_setRequestLocale } from "next-intl/server";
import { RegisterWizard } from "@/components/RegisterWizard";
import { SyntheticDataBanner } from "@/components/SyntheticDataBanner";

export default function RegisterPage({ params: { locale } }: { params: { locale: string } }) {
  unstable_setRequestLocale(locale);
  return (
    <>
      <SyntheticDataBanner />
      <main id="main" className="portal-gradient grid min-h-dvh place-items-center p-4">
        <RegisterWizard />
      </main>
    </>
  );
}
