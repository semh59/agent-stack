/**
 * Data page — where Sovereign stores its persistent state on disk.
 */
import { Database } from "lucide-react";
import { Card, Input, Row, Section } from "../../../../components/sovereign/primitives";
import { useSovereignStore } from "../../../../store/sovereignStore";
import { getAtPath, useEffectiveSettings } from "../useEffectiveSettings";

export function DataPage() {
  const effective = useEffectiveSettings();
  const { updateSettingsPath } = useSovereignStore();

  return (
    <div className="space-y-10">
      <Section
        title="Data directory"
        description="Root folder for SQLite databases, cache files, vector indexes, and logs."
        icon={<Database size={16} />}
      >
        <Card>
          <Row
            label="Path"
            hint="Must be writable by the bridge process. On Linux servers, /var/lib/sovereign is typical."
          >
            <Input
              value={getAtPath<string>(effective, "data.data_dir", "") ?? ""}
              onChange={(e) => updateSettingsPath("data.data_dir", e.target.value)}
              placeholder="/data"
            />
          </Row>
        </Card>
      </Section>
    </div>
  );
}
