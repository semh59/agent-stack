import { Section, Row, Switch } from "../../../../components/sovereign/primitives";
import { Palette } from "lucide-react";
import { useAppStore } from "../../../../store/appStore";

export function AppearancePage() {
  const { theme, toggleTheme } = useAppStore();

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Palette size={16} />}
        title="Gorunum"
        description="Tema ve gorsel tercihlerinizi ayarlayin."
      >
        <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
          <Row label="Karanlik tema" hint="Arayuz icin karanlik renk semasinı kullan.">
            <Switch
              checked={theme === "dark"}
              onChange={toggleTheme}
              ariaLabel="Karanlik tema"
            />
          </Row>
        </div>
      </Section>
    </div>
  );
}
