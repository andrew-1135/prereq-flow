import { nanoid } from "nanoid";

import dagre from "dagre";

import {
  isNode,
  isEdge,
  getConnectedEdges,
  getIncomers,
  getOutgoers,
  removeElements,
} from "react-flow-renderer";

export const ZERO_POSITION = { x: 0, y: 0 };
const CRS = String.raw`(?:[A-Z&]+ )+\d{3}`; // COURSE_REGEX_STRING
export const COURSE_REGEX = new RegExp(CRS, "g"); // AAA 000

const EITHER_OR_REGEX = /\b(?:[Ei]ther|or)\b/;

const DOUBLE_EITHER_REGEX = new RegExp(`(?:[Ee]ither )?(${CRS}) or (${CRS})`);
// "AAA 000 or AAA 111"
const TRIPLE_EITHER_REGEX = new RegExp(
  `(?:[Ee]ither )?(${CRS}), (${CRS}),? or (${CRS})`
);
// "AAA 000, AAA 111, or AAA 222"

const CONCURRENT_REGEX = (
  /(?:either of )?which may be taken concurrently(?:\. Instructor|\.?$)/
);

export function newCourseNode(courseData) {
  return {
    id: courseData.id,
    type: "course",
    position: ZERO_POSITION,
    data: {
      ...courseData,
      nodeStatus: "over-one-away",
      nodeConnected: false,
    }
  };
}

export function newConditionalNode(type, position = ZERO_POSITION) {
  return {
    id: `${type.toUpperCase()}-${nanoid()}`,
    type,
    position,
    data: {
      nodeStatus: "completed",
      nodeConnected: false,
    }
  };
}

export function edgeArrowId(source, target) {
  return `${source} -> ${target}`;
}

export function newEdge(source, target, id = null) {
  const edgeId = id ?? edgeArrowId(source, target);
  return {
    id: edgeId,
    source,
    target,
    className: "over-one-away",
    label: null, // Need to have this in order to notify React Flow about CC
  };
}

function addEdges(sources, target, elements, elementIds) {
  for (const source of sources) {
    const edgeId = edgeArrowId(source, target);
    if (elementIds.has(source)
        && !elementIds.has(edgeId)
        && !elementIds.has(edgeArrowId(target, source))) { // For BIOL cycles
      elements.push(newEdge(source, target, edgeId));
      elementIds.add(edgeId);
    }
  }
}

export const CONCURRENT_LABEL = {
  label: "CC",
  labelBgPadding: [2, 2],
  labelBgBorderRadius: 4,
};

export function generateInitialElements(courseData, ambiguousHandling) {
  const elements = courseData.map(c => newCourseNode(c));
  const elementIds = new Set(courseData.map(c => c.id));
  const secondPass = new Map();

  // First pass: unambiguous prerequisites
  for (const data of courseData) {
    const courseId = data.id;
    const { prerequisite } = data;
    if (!COURSE_REGEX.test(prerequisite)) {
      // No prerequisites
      continue;
    }

    const reqSections = prerequisite.split(";");
    for (const section of reqSections) {
      const courseMatches = section.match(COURSE_REGEX);
      // if (courseMatches.length === 1 && !EITHER_OR_REGEX.test(section)) {
      if (!courseMatches) {
        continue;
      } else if (courseMatches.length === 1) {
        addEdges(courseMatches, courseId, elements, elementIds);
      } else {
        if (!secondPass.has(courseId)) {
          secondPass.set(courseId, []);
        }
        secondPass.get(courseId).push(section);
      }
    }
  }
  // TODO: E E 215 "a or (b and (c or d))"
  // TODO: MATH 309 "(a and b) or c"
  // State machine maybe (look into JSON parsing)
  // TODO: Co-requisites

  // Second pass: single "or" prerequisites and unparsable
  for (const [course, problemSection] of secondPass.entries()) {
    for (const section of problemSection) {
      const doubleEitherMatch = section.match(DOUBLE_EITHER_REGEX);
      const tripleEitherMatch = section.match(TRIPLE_EITHER_REGEX);
      const matches = tripleEitherMatch || doubleEitherMatch;
      // Double can match triple but not the other way around
      const numCourses = section.match(COURSE_REGEX).length;

      if (matches && matches.length === numCourses + 1) {
        // If not all courses captured (i.e. 3+), it's a false match
        // matches includes full string match

        const alreadyRequired = matches.slice(1).filter(m => elementIds.has(m));
        if (alreadyRequired.length === 1) {
          // One option is already required
          let edge = newEdge(...alreadyRequired, course);
          if (CONCURRENT_REGEX.test(section)) {
            edge = { ...edge, ...CONCURRENT_LABEL };
          }
          elements.push(edge);
        } else if (alreadyRequired.length > 1) {
          // More than one option is already required
          const orNode = newConditionalNode("or");
          elements.push(orNode);
          elements.push(newEdge(orNode.id, course));
          for (const req of alreadyRequired) {
            let edge = newEdge(req, orNode.id);
            if (CONCURRENT_REGEX.test(section)) {
              edge = { ...edge, ...CONCURRENT_LABEL };
            }
            elements.push(edge);
          }
        } else if (ambiguousHandling === "aggressively") {
          addEdges(matches.slice(1), course, elements, elementIds);
        }
      } else if (ambiguousHandling === "aggressively") {
        addEdges(section.match(COURSE_REGEX), course, elements, elementIds);
      }
    }
  }
  return elements;
}

function getIncomingEdges(targetNode, elements) {
  const connectedEdges = getConnectedEdges(
    [targetNode], elements.filter(elem => isEdge(elem))
  );
  return connectedEdges.filter(edge => edge.target === targetNode.id);
}

function getOutgoingEdges(targetNode, elements) {
  const connectedEdges = getConnectedEdges(
    [targetNode], elements.filter(elem => isEdge(elem))
  );
  return connectedEdges.filter(edge => edge.source === targetNode.id);
}

function discoverMaxDepths(startNodeId, startDepth, nodeData) {
  for (const outgoerId of nodeData.get(startNodeId).outgoingNodes) {
    nodeData.get(outgoerId).depth = Math.max(
      nodeData.get(outgoerId).depth, startDepth + 1
    );
    discoverMaxDepths(outgoerId, startDepth + 1, nodeData);
  }
}

export function newNodeData(elements) {
  const initialNodeData = new Map();
  const roots = [];
  for (const node of elements.filter(elem => isNode(elem))) {
    const nodeId = node.id;
    const newData = {
      depth: 0,
      incomingNodes: getIncomers(node, elements).map(elem => elem.id),
      incomingEdges: getIncomingEdges(node, elements).map(elem => elem.id),
      outgoingEdges: getOutgoingEdges(node, elements).map(elem => elem.id),
      outgoingNodes: getOutgoers(node, elements).map(elem => elem.id),
    };
    newData.connectedEdges = [
      ...newData.incomingEdges, ...newData.outgoingEdges,
    ];
    newData.connectedNodes = [
      ...newData.incomingNodes, ...newData.outgoingNodes,
    ];
    initialNodeData.set(nodeId, newData);

    if (newData.incomingNodes.length === 0) {
      roots.push(nodeId);
    }
  }
  for (const root of roots) {
    discoverMaxDepths(root, 0, initialNodeData);
  }

  return initialNodeData;
}

export function sortElementsByDepth(elements, nodeData) {
  return elements.sort((a, b) => {
    const aVal = (
      isNode(a) ? nodeData.get(a.id).depth : Number.POSITIVE_INFINITY
    );
    const bVal = (
      isNode(b) ? nodeData.get(b.id).depth : Number.POSITIVE_INFINITY
    );

    return aVal - bVal;
  });
}

export function newElemIndexes(elements) {
  return new Map(elements.map((elem, i) => [elem.id, i]));
}

const COURSE_STATUSES = [
  "completed", // 0
  "enrolled", // 1
  "ready", // 2
  "under-one-away", // 3
  "one-away", // 4
  "over-one-away", // 5
];

export const COURSE_STATUS_CODES = Object.freeze(Object.fromEntries(
  COURSE_STATUSES.map((status, i) => [status, i])
));

export function setNodeStatus(
  nodeId, newStatus, elements, nodeData, elemIndexes
) {
  elements[elemIndexes.get(nodeId)].data.nodeStatus = newStatus;
  for (const edgeId of nodeData.get(nodeId).outgoingEdges) {
    elements[elemIndexes.get(edgeId)] = {
      ...elements[elemIndexes.get(edgeId)], className: newStatus
    };
  }
}

function getEdgeStatus(edge) {
  let edgeStatusCode = COURSE_STATUS_CODES[edge.className];
  if (edgeStatusCode === COURSE_STATUS_CODES.enrolled
      && edge.label === "CC") {
    edgeStatusCode = COURSE_STATUS_CODES.completed;
  }
  return edgeStatusCode;
}

export function updateNodeStatus(nodeId, elements, nodeData, elemIndexes) {
  const targetNode = elements[elemIndexes.get(nodeId)];
  const currentStatus = targetNode.data.nodeStatus;
  const incomingEdges = nodeData.get(nodeId).incomingEdges.map(id => (
    elements[elemIndexes.get(id)]
  ));

  let newStatus;
  switch (targetNode.type) {
    case "course": {
      let newStatusCode = Math.max(...incomingEdges.map(getEdgeStatus));
      newStatusCode = (
        newStatusCode === Number.NEGATIVE_INFINITY ? 0 : newStatusCode
      );
      // Math.max() with no args -> negative infinity

      if (newStatusCode === 0) {
        newStatus = (
          currentStatus === "completed" || currentStatus === "enrolled"
            ? currentStatus
            : "ready"
        );
        // All prereqs completed (or concurrently enrolled)
      } else if (newStatusCode === 1) {
        newStatus = "under-one-away";
        // All prereqs will be complete after finishing currently enrolled
      } else if (newStatusCode === 2) {
        newStatus = "one-away";
        // All prereqs ready for enrollment
      } else if (newStatusCode > 2) {
        newStatus = "over-one-away";
        // At least one prereq not ready for enrollment
      }
      break;
    }
    case "and": {
      let newStatusCode = Math.max(...incomingEdges.map(getEdgeStatus));
      newStatusCode = (
        newStatusCode === Number.NEGATIVE_INFINITY ? 0 : newStatusCode
      );
      // Math.max() with no args -> negative infinity

      newStatus = COURSE_STATUSES[newStatusCode];
      // Add node should be complete if no prereqs
      break;
    }
    case "or": {
      let newStatusCode = Math.min(...incomingEdges.map(getEdgeStatus));
      newStatusCode = (
        newStatusCode === Number.POSITIVE_INFINITY ? 0 : newStatusCode
      );
      // Math.min() with no args -> positive infinity

      newStatus = COURSE_STATUSES[newStatusCode];
    }
      break;
    default:
      break;
  }

  setNodeStatus(nodeId, newStatus, elements, nodeData, elemIndexes);
}

export function updateAllNodes(elements, nodeData, elemIndexes) {
  const updatedElements = elements.slice();
  const numNodes = nodeData.size;
  for (let i = 0; i < numNodes; i++) {
    updateNodeStatus(elements[i].id, updatedElements, nodeData, elemIndexes);
  }
  return updatedElements;
}

const nodesep = 75; // Vertical spacing
const ranksep = 250; // Horizontal spacing
const nodeWidth = 172;
const nodeHeight = 36;

export const nodeSpacing = ranksep + nodeWidth;
// For autopositioning

function generateDagreLayout(elements) {
  const dagreGraph = new dagre.graphlib.Graph();
  dagreGraph.setDefaultEdgeLabel(() => ({}));
  dagreGraph.setGraph({ rankdir: "LR", ranksep, nodesep });

  for (const elem of elements) {
    if (isNode(elem)) {
      dagreGraph.setNode(elem.id, { width: nodeWidth, height: nodeHeight });
    } else {
      dagreGraph.setEdge(elem.source, elem.target);
    }
  }

  dagre.layout(dagreGraph);

  const arrangedElements = elements.map(elem => {
    if (isNode(elem)) {
      const node = dagreGraph.node(elem.id);

      // Slight random change is needed as a hack to notify react flow
      // about the change.
      // This also shifts the dagre node anchor (center center) to
      // match react flow anchor (top left)
      elem.position = {
        x: node.x - (nodeWidth / 2) + (Math.random() / 1000),
        y: node.y - (nodeHeight / 2),
      };
    }

    return elem;
  });

  return arrangedElements;
}

function filterUnconditionalElements(condNodes, elems, nData) {
  let tempElements = elems.slice();
  let tempNodeData = new Map(nData.entries());

  for (const elem of condNodes) {
    const node = tempNodeData.get(elem.id);

    for (const iNode of node.incomingNodes) {
      for (const oNode of node.outgoingNodes) {
        const edgeId = edgeArrowId(iNode, oNode);
        if (!tempNodeData.has(edgeId)) {
          tempElements.push(newEdge(iNode, oNode));
        }
      }
    }
    tempElements = removeElements([elem], tempElements);
    tempNodeData = newNodeData(tempElements);
  }

  return tempElements;
}

function getSourcePositions(nodeId, elems, indexes, nData) {
  const node = elems[indexes.get(nodeId)];
  return (
    node.type === "course"
      ? node.position
      : (
        nData.get(nodeId).incomingNodes
          .map(nId => getSourcePositions(nId, elems, indexes, nData))
          .flat()
      )
  );
}

function averagePosition(positions) {
  const avgSourcePosition = positions.reduce((a, b) => (
    { x: a.x + b.x, y: a.y + b.y }
  ), ZERO_POSITION);
  avgSourcePosition.x /= positions.length;
  avgSourcePosition.y /= positions.length;
  return avgSourcePosition;
}

export function averageYPosition(positions) {
  return (
    positions
      .map(pos => pos.y)
      .reduce((a, b) => a + b)
      / positions.length
  );
}

export function generateNewLayout(elems, indexes, nData) {
  const newElements = elems.slice();

  // Conditional nodes should not influence course depth/positioning
  const conditionalNodes = elems.filter(elem => (
    isNode(elem) && elem.type !== "course"
  ));

  let dagreLayout;
  if (!conditionalNodes.length) {
    dagreLayout = generateDagreLayout(
      elems.slice().sort(() => Math.random() - 0.5)
    );
  } else {
    const filteredElements = filterUnconditionalElements(
      conditionalNodes, elems, nData
    );

    // https://flaviocopes.com/how-to-shuffle-array-javascript/
    dagreLayout = generateDagreLayout(
      filteredElements.sort(() => Math.random() - 0.5)
    );
  }

  for (const dagElem of dagreLayout) {
    if (isNode(dagElem)) {
      const i = indexes.get(dagElem.id);
      newElements[i].position = dagElem.position;
    }
  }

  conditionalNodes.reverse();
  for (const node of conditionalNodes) {
    const i = indexes.get(node.id);
    const data = nData.get(node.id);
    const { incomingNodes, outgoingNodes } = data;

    if (incomingNodes.length && outgoingNodes.length) {
      const incomingPositions = incomingNodes.map(nodeId => (
        getSourcePositions(nodeId, elems, indexes, nData)
      )).flat();
      const outgoingPositions = outgoingNodes.map(nodeId => (
        newElements[indexes.get(nodeId)].position
      ));
      const x = (
        Math.min(...outgoingPositions.map(pos => pos.x)) - nodeWidth * 0.5
      );
      const avgSourcePosition = averagePosition(incomingPositions);
      const avgDestPosition = averagePosition(outgoingPositions);
      const slope = (
        (avgDestPosition.y - avgSourcePosition.y)
        / (avgDestPosition.x - avgSourcePosition.x)
      );
      const y = -nodeWidth * slope + avgDestPosition.y;
      newElements[i].position = { x, y };
    } else if (incomingNodes.length && !outgoingNodes.length) {
      const incomingPositions = incomingNodes.map(nodeId => (
        newElements[indexes.get(nodeId)].position
      ));
      const x = (
        Math.max(...incomingPositions.map(pos => pos.x)) + nodeWidth * 1.1
      );
      const y = averageYPosition(incomingPositions);
      newElements[i].position = { x, y };
    } else if (!incomingNodes.length && outgoingNodes.length) {
      const outgoingPositions = outgoingNodes.map(nodeId => (
        newElements[indexes.get(nodeId)].position
      ));
      const x = (
        Math.min(...outgoingPositions.map(pos => pos.x)) - nodeWidth * 0.5
      );
      const y = averageYPosition(outgoingPositions);
      newElements[i].position = { x, y };
    }
  }
  // Magic multipliers to compensate for unkown conditional node width

  return newElements;
}

export const _testing = {
  EITHER_OR_REGEX,
  COURSE_REGEX,
  DOUBLE_EITHER_REGEX,
  TRIPLE_EITHER_REGEX,
  CONCURRENT_REGEX,
};
