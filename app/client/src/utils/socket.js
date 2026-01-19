import { io } from "socket.io-client";

const SERVER_URL = "http://localhost:3000";

export const socket = io(SERVER_URL);

export const fetchReferences = async (filepath, line, name) => {
  const response = await fetch(`${SERVER_URL}/api/references`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filepath, line, name }),
  });
  return response.json();
};

export const fetchExpandFile = async (filepath) => {
  const response = await fetch(`${SERVER_URL}/api/expand-file`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filepath }),
  });
  return response.json();
};
