/** 服务端运行时状态，供路由层读取（避免循环依赖） */

let serverPort = 1998;

export const getServerPort = (): number => serverPort;

export const setServerPort = (port: number): void => {
  serverPort = port;
};
