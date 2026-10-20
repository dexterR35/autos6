import { RayIndex } from './rayIndex.js';
self.onmessage = ({ data }) => {
  const result = new RayIndex(data).toTransfer();
  self.postMessage(result, [result.positions.buffer, result.owners.buffer, result.order.buffer, result.boxes.buffer, result.nodes.buffer]);
};
