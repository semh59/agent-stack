import { Section } from "../../../../components/sovereign/primitives";
import { Database, Trash2 } from "lucide-react";

export function DataPage() {
  return (
    <div className="flex flex-col gap-6">
      <Section
        icon={<Database size={16} />}
        title="Veri Yonetimi"
        description="Konusma gecmisi ve uygulama verilerini yonetin."
      >
        <div className="flex flex-col gap-3 p-4">
          <div className="flex items-center justify-between rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-[var(--color-alloy-text)]">Konusma gecmisi</p>
              <p className="text-[12px] text-[var(--color-alloy-text-sec)]">Tum konusma gecmisini kalici olarak sil.</p>
            </div>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={13} />
              Sil
            </button>
          </div>
          <div className="flex items-center justify-between rounded-xl border border-[var(--color-alloy-border)] bg-[var(--color-alloy-bg)] px-4 py-3">
            <div>
              <p className="text-[13px] font-medium text-[var(--color-alloy-text)]">Uygulama verileri</p>
              <p className="text-[12px] text-[var(--color-alloy-text-sec)]">Tum ayarlari ve cache'i sifirla.</p>
            </div>
            <button
              type="button"
              className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-medium text-red-600 hover:bg-red-100 transition-colors"
            >
              <Trash2 size={13} />
              Sifirla
            </button>
          </div>
        </div>
      </Section>
    </div>
  );
}
