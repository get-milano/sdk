// The gradient is a visual detail; the bridge only needs the component to
// exist when the banner renders in Node.
import { createElement } from "react";

export const LinearGradient = ({ children, ...props }) =>
  createElement("LinearGradient", props, children);

export default { LinearGradient };
