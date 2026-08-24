// Public API домена printing (собирается по подэтапам 8.1–8.6).
// materials (8.2):
export { MaterialsScreen } from "./materials/materialsscreen.tsx";
export { MaterialDetailScreen } from "./materials/detail/materialdetailscreen.tsx";
// plate (8.3):
export { PlateScreen } from "./plate/platescreen.tsx";
// printers (8.4):
export { PrinterCompareScreen } from "./printers/comparescreen.tsx";
export { PrinterDetailScreen } from "./printers/printerdetailscreen.tsx";
export { PrintersScreen } from "./printers/printersscreen.tsx";
export { PrinterReleasesScreen } from "./printers/releasesscreen.tsx";
export { printerCommunityPreviewById } from "./printers/communitypreview.ts";
// park (8.5):
export { ParkAddScreen } from "./park/addwizard.tsx";
export { CommunityFirmwareScreen } from "./park/communityfirmwarescreen.tsx";
export { DiyScreen } from "./park/diyscreen.tsx";
export { ParkScreen } from "./park/parkscreen.tsx";
export { SlicePrintScreen } from "./park/sliceprintscreeen.tsx";
export { PrinterLiveScreen } from "./park/printerlivescreen.tsx";
export { PrinterDeviceMissingScreen } from "./park/printerdevicemissing.tsx";
// printerface (8.6):
export { PrinterFaceScreen } from "./printerface/printerfacescreen.tsx";
