// A stand-in for react-native, so the bridge can be rendered in Node.
//
// React Native's own modules need Metro and its Flow transforms, which a
// plain Node process does not have. The bridge does not care: it only
// needs components to exist and to receive the props it passes. Every
// primitive below becomes a host element named after itself, so the
// rendered tree reads like the component names in the source.
import { createElement } from "react";

const host =
  (name) =>
  ({ children, ...props }) =>
    createElement(name, props, children);

export const View = host("View");
export const Text = host("Text");
export const Image = host("Image");
export const ScrollView = host("ScrollView");
export const Pressable = ({ children, style, ...props }) =>
  createElement(
    "Pressable",
    props,
    typeof children === "function" ? children({ pressed: false }) : children,
  );
export const Switch = host("Switch");
export const TextInput = host("TextInput");
export const ActivityIndicator = host("ActivityIndicator");
export const Modal = host("Modal");

export const StyleSheet = {
  create: (styles) => styles,
  absoluteFill: { position: "absolute" },
};

export const Platform = { OS: "ios", select: (options) => options.ios ?? options.default };

export const AccessibilityInfo = {
  announceForAccessibility: () => {},
};

export const Linking = {
  openURL: async () => {},
};

export function useColorScheme() {
  return "light";
}

export default {
  View,
  Text,
  Image,
  ScrollView,
  Pressable,
  Switch,
  TextInput,
  ActivityIndicator,
  Modal,
  StyleSheet,
  Platform,
  AccessibilityInfo,
  Linking,
  useColorScheme,
};
