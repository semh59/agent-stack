import { useState } from "react";
import { Section, Row, Switch, Field, Input, Button } from "../../../../components/Alloy/primitives";
import { Zap } from "lucide-react";

export function PipelinePage() {
  const [maxConcurrent, setMaxConcurrent] = useState("3");
  const [timeout, setTimeout_] = useState("120");
  const [autoRetry, setAutoRetry] = useState(true);
  const [saved, setSaved] = useState(false);

  function handleSave() {
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Zap size={16} />}
        title="Pipeline Ayarlari"
        description="Ajan pipeline calisma parametrelerini ayarlayin."
      >
        <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
          <Row label="Otomatik yeniden deneme" hint="Basarisiz gorevleri otomatik olarak yeniden calistir.">
            <Switch checked={autoRetry} onChange={() => setAutoRetry(!autoRetry)} ariaLabel="Otomatik yeniden deneme" />
          </Row>
        </div>

        <div className="flex flex-col gap-4 p-4 border-t border-[var(--color-alloy-border)]">
          <Field label="Maksimum eszamanli gorev" htmlFor="max-concurrent">
            <Input id="max-concurrent" type="number" min="1" max="10" value={maxConcurrent} onChange={(e) => setMaxConcurrent(e.target.value)} />
          </Field>
          <Field label="Zaman asimi (saniye)" htmlFor="timeout">
            <Input id="timeout" type="number" min="30" value={timeout} onChange={(e) => setTimeout_(e.target.value)} />
          </Field>
          <Button size="sm" onClick={handleSave}>
            {saved ? "Kaydedildi!" : "Kaydet"}
          </Button>
        </div>
      </Section>
    </div>
  );
}
