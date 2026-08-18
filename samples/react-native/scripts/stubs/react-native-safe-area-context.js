import { createElement } from "react";

export const SafeAreaView = ({ children, ...props }) =>
  createElement("SafeAreaView", props, children);
export const SafeAreaProvider = ({ children }) => children;
export const useSafeAreaInsets = () => ({ top: 0, bottom: 0, left: 0, right: 0 });

export default { SafeAreaView, SafeAreaProvider, useSafeAreaInsets };
