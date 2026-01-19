import { useEffect, useState, useCallback } from "react";
import { socket } from "../utils/socket";

export const useSocket = () => {
  const [connected, setConnected] = useState(false);
  const [neovimConnected, setNeovimConnected] = useState(false);
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    if (socket.connected) {
      setConnected(true);
    }

    const handleConnect = () => {
      console.log("Connected to server");
      setConnected(true);
    };

    const handleDisconnect = () => {
      console.log("Disconnected from server");
      setConnected(false);
    };

    const handleNeovimConnected = ({ cwd }) => {
      console.log("Neovim connected:", cwd);
      setNeovimConnected(true);
      setCwd(cwd);
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("neovim:connected", handleNeovimConnected);

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("neovim:connected", handleNeovimConnected);
    };
  }, []);

  return { connected, neovimConnected, cwd };
};

export const useGraphEvents = (onGraphData) => {
  useEffect(() => {
    const handleGraphData = (data) => {
      console.log("Received graph data:", data);
      onGraphData(data);
    };

    socket.on("graph:data", handleGraphData);

    return () => {
      socket.off("graph:data", handleGraphData);
    };
  }, [onGraphData]);
};
