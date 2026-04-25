import { Section } from "../../../../components/Alloy/primitives";
import { Activity } from "lucide-react";

export function ObservabilityPage() {
  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Activity size={16} />}
        title="Gozlemlenebilirlik"
        description="Token kullanimi, gecikme ve maliyet metriklerini izleyin."
      >
        <div className="p-4 text-[13px] text-[var(--color-alloy-text-sec)]">
          Metrik goruntusu yakinlarda eklenecek.
        </div>
      </Section>
    </div>
  );
}
