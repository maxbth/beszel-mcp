import listSystems from './list-systems';
import getSystem from './get-system';
import getSystemMetrics from './get-system-metrics';
import listContainers from './list-containers';
import getContainerMetrics from './get-container-metrics';
import getContainerLogs from './get-container-logs';
import listServices from './list-services';
import getServiceDetails from './get-service-details';
import listSmartDevices from './list-smart-devices';
import listAlerts from './list-alerts';
import getAlertHistory from './get-alert-history';
import getHubInfo from './get-hub-info';
import type {ToolModule} from './types';

export const TOOLS: Array<ToolModule> = [
  listSystems,
  getSystem,
  getSystemMetrics,
  listContainers,
  getContainerMetrics,
  getContainerLogs,
  listServices,
  getServiceDetails,
  listSmartDevices,
  listAlerts,
  getAlertHistory,
  getHubInfo,
];
