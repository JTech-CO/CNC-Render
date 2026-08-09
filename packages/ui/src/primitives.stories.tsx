import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import {
  Button,
  DataTable,
  Dialog,
  ParameterRow,
  Tabs,
  UnitInput,
} from "./primitives";

const meta = {
  title: "CNC Render/Primitives",
  component: Button,
  parameters: {
    layout: "padded",
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <div style={{ display: "flex", gap: "12px" }}>
      <Button variant="primary">실행</Button>
      <Button>저장</Button>
      <Button variant="danger">정지</Button>
      <Button disabled>사용 불가</Button>
    </div>
  ),
};

export const InputsAndParameters: Story = {
  render: () => (
    <div style={{ maxWidth: "520px" }}>
      <ParameterRow label="소재 길이" hint="내부 단위는 mm입니다.">
        <UnitInput defaultValue="60.00" label="소재 길이" unit="mm" />
      </ParameterRow>
      <ParameterRow label="주축 속도">
        <UnitInput defaultValue="2400" label="주축 속도" unit="rpm" />
      </ParameterRow>
    </div>
  ),
};

export const Table: Story = {
  render: () => (
    <DataTable
      caption="축 위치"
      columns={[
        { key: "axis", header: "축", render: (row) => row.axis },
        {
          key: "position",
          header: "위치",
          numeric: true,
          render: (row) => `${row.position.toFixed(2)} mm`,
        },
      ]}
      getRowKey={(row) => row.axis}
      rows={[
        { axis: "X", position: -10 },
        { axis: "Y", position: 5 },
        { axis: "Z", position: 8 },
      ]}
    />
  ),
};

function TabsFixture() {
  const [value, setValue] = useState<"gcode" | "diagnostics">("gcode");
  return (
    <div>
      <Tabs
        ariaLabel="하단 패널"
        idBase="storybook"
        items={[
          { value: "gcode", label: "G-code" },
          { value: "diagnostics", label: "Diagnostics" },
        ]}
        onChange={setValue}
        value={value}
      />
      <section
        aria-labelledby={`storybook-tab-${value}`}
        id={`storybook-panel-${value}`}
        role="tabpanel"
        style={{ borderTop: "1px solid var(--border-subtle)", padding: "16px" }}
      >
        {value === "gcode" ? "G-code 미리보기" : "진단 없음"}
      </section>
    </div>
  );
}

export const TabNavigation: Story = {
  render: () => <TabsFixture />,
};

function DialogFixture() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>도움말 열기</Button>
      <Dialog
        onDismiss={() => setOpen(false)}
        open={open}
        title="CNC Render 도움말"
      >
        <p>작업 영역과 실행 제어는 키보드로도 이동할 수 있습니다.</p>
      </Dialog>
    </>
  );
}

export const HelpDialog: Story = {
  render: () => <DialogFixture />,
};
