import { Section, Row, Switch } from "../../../../components/sovereign/primitives";
import { GitBranch } from "lucide-react";
import { useState } from "react";

export function RoutingPage() {
  const [loadBalance, setLoadBalance] = useState(true);
  const [fallback, setFallback] = useState(true);
  const [costOptimize, setCostOptimize] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<GitBranch size={16} />}
        title="Rotalama Stratejisi"
        description="Isteklerin hesaplar arasinda nasil dagitilacagini ayarlayin."
      >
        <div className="flex flex-col divide-y divide-[var(--color-alloy-border)]">
          <Row label="Yuk dengeleme" hint="Istekleri tum aktif hesaplar arasinda dengeli dagit.">
            <Switch checked={loadBalance} onChange={() => setLoadBalance(!loadBalance)} ariaLabel="Yuk dengeleme" />
          </Row>
          <Row label="Otomatik yedek" hint="Bir hesap basarisiz olursa otomatik olarak diger hesaba gec.">
            <Switch checked={fallback} onChange={() => setFallback(!fallback)} ariaLabel="Otomatik yedek" />
          </Row>
          <Row label="Maliyet optimizasyonu" hint="En dusuk maliyetli hesabi tercih et.">
            <Switch checked={costOptimize} onChange={() => setCostOptimize(!costOptimize)} ariaLabel="Maliyet optimizasyonu" />
          </Row>
        </div>
      </Section>
    </div>
  );
}
