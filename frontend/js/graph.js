// === 3D 贝塞尔路网拓扑与 A* 寻路 ===
    class LaneGraph3D {
      constructor() {
        this.nodes = new Map();
        this.lanes = new Map();
        this.adjacency = new Map();
        this.nextNodeId = 1;
        this.nextLaneId = 1;
      }
      addNode(x, y, z, type = 'ground') {
        const id = this.nextNodeId++;
        this.nodes.set(id, { id, pos: new Vec3(x, y, z), type });
        this.adjacency.set(id, []);
        return id;
      }
      addLane(fromId, toId, roadClass = 'dirt', isOffroad = false) {
        const fromNode = this.nodes.get(fromId);
        const toNode = this.nodes.get(toId);
        if (!fromNode || !toNode) return null;

        const id = this.nextLaneId++;
        let curve;
        if (Math.abs(fromNode.pos.z - toNode.pos.z) > 4) {
          const mid = Vec3.lerp(fromNode.pos, toNode.pos, 0.5);
          const p1 = new Vec3(mid.x, mid.y, fromNode.pos.z);
          const p2 = new Vec3(mid.x, mid.y, toNode.pos.z);
          curve = new Curve3D(fromNode.pos, p1, p2, toNode.pos);
        } else {
          curve = Curve3D.straight(fromNode.pos, toNode.pos);
        }

        const baseSpeed = roadClass === 'cobble' ? 44 : 36;
        const speedLimit = isOffroad ? baseSpeed * 0.5 : baseSpeed;
        const lane = { id, from: fromId, to: toId, curve, roadClass, speedLimit, isOffroad, wear: 0.0 };
        this.lanes.set(id, lane);
        this.adjacency.get(fromId).push(id);

        // 双向往返车道互联 (走的人不论去程返程，共同踩踏加固两点之间的物理通道)
        const revLanes = this.adjacency.get(toId) || [];
        for (const rId of revLanes) {
          const rLane = this.lanes.get(rId);
          if (rLane && rLane.to === fromId) {
            lane.reverseId = rId;
            rLane.reverseId = id;
            break;
          }
        }
        return id;
      }
      tickWearDecay(dt) {
        const decayRatePerSec = 0.010 / 1.5; // 固定百分比衰减：1/150 ≈ 0.667%/秒 (当等级为1.5时衰减速率为 0.010/s)
        for (const lane of this.lanes.values()) {
          if (lane.wear > 0) {
            lane.wear = Math.max(0, lane.wear - lane.wear * decayRatePerSec * dt);
            if (lane.wear < 0.0001) lane.wear = 0.0;
          }
        }
      }
      findPath(startId, goalId) {
        if (!this.nodes.has(startId) || !this.nodes.has(goalId)) return null;
        if (startId === goalId) return [];

        const frontier = [{ id: startId, cost: 0 }];
        const cameFrom = new Map();
        const costSoFar = new Map();
        costSoFar.set(startId, 0);

        while (frontier.length > 0) {
          frontier.sort((a, b) => a.cost - b.cost);
          const current = frontier.shift();
          if (current.id === goalId) break;

          const neighborLanes = this.adjacency.get(current.id) || [];
          for (const laneId of neighborLanes) {
            const lane = this.lanes.get(laneId);
            if (!lane) continue;
            const nextNode = lane.to;
            const deltaZ = lane.curve.p3.z - lane.curve.p0.z;
            const gradeCost = deltaZ > 0 ? (deltaZ / lane.curve.length) * 1.5 : 0;
            const offroadPenalty = lane.isOffroad ? 2.0 : 1.0;

            // 道路等级与动态踩踏度带来的实际速度倍率 (0.50x ~ 2.20x)
            const wear = lane.wear || 0.0;
            const roadLevelFactor = Math.min(2.20, Math.max(0.50, 0.50 + 0.333 * wear));
            const effectiveSpeed = lane.speedLimit * roadLevelFactor;

            const newCost = costSoFar.get(current.id) + ((lane.curve.length / effectiveSpeed) + gradeCost) * offroadPenalty;

            if (!costSoFar.has(nextNode) || newCost < costSoFar.get(nextNode)) {
              costSoFar.set(nextNode, newCost);
              const goalPos = this.nodes.get(goalId).pos;
              const nextPos = this.nodes.get(nextNode).pos;
              const h = nextPos.distanceTo(goalPos) / (44 * 2.2);
              frontier.push({ id: nextNode, cost: newCost + h });
              cameFrom.set(nextNode, { prevNode: current.id, laneId });
            }
          }
        }

        if (!cameFrom.has(goalId)) {
          const directLaneId = this.addLane(startId, goalId, 'dirt', true);
          this.addLane(goalId, startId, 'dirt', true);
          return [directLaneId];
        }

        const path = [];
        let curr = goalId;
        while (curr !== startId) {
          const step = cameFrom.get(curr);
          path.unshift(step.laneId);
          curr = step.prevNode;
        }
        return path;
      }
    }
