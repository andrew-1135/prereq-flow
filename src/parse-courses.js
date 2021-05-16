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
  // const elements = Object.keys(courseData).map(c => {
  //   const prereqText = courseData[c].prereqText.replace(/ ?Instructor.+$/, "");
  //   const prereqList = prereqText.split(";").map(s => s.trim());
  //   const elemNode = newCourseNode(c);
  //   elemNode.data = { ...elemNode.data, prereqs: prereqList };
  //   return elemNode;
  // });
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
        if (alreadyRequired.length) {
          // Some of the choices are already required, so go with those
          // TODO: implement OR into react flow

          for (const req of alreadyRequired) {
            let edge = newEdge(req, course);
            if (CONCURRENT_REGEX.test(section)) {
              edge = { ...edge, ...CONCURRENT_LABEL };
            }
            elements.push(edge);
            if (!elementIds.has(req)) {
              elements.push(newCourseNode(req));
              elementIds.add(req);
            }
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

export const _testing = {
  EITHER_OR_REGEX,
  COURSE_REGEX,
  DOUBLE_EITHER_REGEX,
  TRIPLE_EITHER_REGEX,
  CONCURRENT_REGEX,
};
