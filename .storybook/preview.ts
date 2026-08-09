import type { Preview } from "@storybook/react-vite";
import "../packages/ui/src/generated/tokens.css";
import "../packages/ui/src/primitives.css";

const preview: Preview = {
  parameters: {
    a11y: {
      test: "error",
    },
    backgrounds: {
      disable: true,
    },
    controls: {
      expanded: true,
    },
  },
};

export default preview;
