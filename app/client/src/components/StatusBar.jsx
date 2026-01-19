const StatusBar = ({ connected, neovimConnected, cwd }) => {
  return (
    <div className="status-bar">
      <div className={`status ${connected ? "connected" : "disconnected"}`}>
        Server: {connected ? "Connected" : "Disconnected"}
      </div>
      <div className={`status ${neovimConnected ? "connected" : "disconnected"}`}>
        Neovim: {neovimConnected ? "Connected" : "Waiting..."}
      </div>
      {cwd && <div className="cwd">{cwd}</div>}
    </div>
  );
};

export default StatusBar;
