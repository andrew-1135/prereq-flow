import React, { useState } from "react";

import type { ModalClass, CloseModal, CourseNode, Element } from "types/main";

import ModalDialog from "./ModalDialog";
import Dropzone from "./Dropzone";
import usePrefersReducedMotion from "../../usePrefersReducedMotion";

import { isNode, isEdge } from "../../utils";

import "./OpenFileDialog.scss";

const SUPPORTED_VERSIONS = ["Beta", "Beta.1"];
const DEPRECATED_VERSIONS: string[] = [];
export const [CURRENT_VERSION] = SUPPORTED_VERSIONS.slice(-1);

function betaToBeta1(elems: Element[]): Element[] {
  // Change node type from "custom" to "course"
  // Remove selected field
  return elems.map(elem => (
    isNode(elem)
      ? { id: elem.id,
        type: "course",
        position: elem.position,
        data: elem.data,
      } as CourseNode
      : elem
  ));
}
const CONVERSION_FUNCS = [betaToBeta1];

interface OpenFileDialogProps {
  modalCls: ModalClass;
  closeDialog: CloseModal;
  openFlow: (openedElements: Element[]) => void;
}
export default function OpenFileDialog({
  modalCls,
  closeDialog,
  openFlow,
}: OpenFileDialogProps) {
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  const prefersReducedMotion = usePrefersReducedMotion();
  function close(): void {
    closeDialog();
    if (!prefersReducedMotion) {
      setTimeout(() => {
        setBusy(false);
        setErrorMsg("");
      }, 100);
    } else {
      setBusy(false);
      setErrorMsg("");
    }
  }

  function openFile(files: File[]): void {
    const [file] = files as [File]; // Only single files allowed

    setBusy(true);

    if (file.type !== "application/json") {
      setErrorMsg("Invalid file type");
      setBusy(false);
      return;
    }
    const reader = new FileReader();
    reader.readAsText(file);

    let loadedData;
    reader.onload = event => {
      // https://github.com/microsoft/TypeScript/issues/4163
      // https://stackoverflow.com/a/35790786 <- Didn't work
      loadedData = JSON.parse((event as any).target.result);

      const structureValid = (
        typeof loadedData === "object"
        && (
          Object.keys(loadedData).toString()
          === ["version", "elements"].toString()
        )
      );
      if (!structureValid) {
        setErrorMsg("Invalid data structure");
        setBusy(false);
        return;
      }

      const loadedVersion = loadedData.version;
      const loadedElems = loadedData.elements;

      if (DEPRECATED_VERSIONS.includes(loadedVersion)) {
        setErrorMsg(`v${loadedVersion} data no longer supported`);
        setBusy(false);
        return;
      } else if (!SUPPORTED_VERSIONS.includes(loadedVersion)) {
        setErrorMsg("Invalid data version");
        setBusy(false);
        return;
      }

      const dataValid = (
        typeof loadedVersion === "string"
        && Array.isArray(loadedElems)
        && loadedElems.every(e => isNode(e) || isEdge(e))
      );
      if (!dataValid) {
        setErrorMsg("Invalid data");
        setBusy(false);
        return;
      }

      let convertedElems = loadedElems;
      if (loadedVersion !== CURRENT_VERSION) {
        const versionIndex = SUPPORTED_VERSIONS.indexOf(loadedVersion);
        for (const func of CONVERSION_FUNCS.slice(versionIndex)) {
          convertedElems = func(convertedElems);
        }
      }

      openFlow(convertedElems);
      close();
    };
  }

  return (
    <ModalDialog
      modalCls={modalCls}
      close={close}
      busy={busy}
      contentCls="OpenFileDialog"
      contentAriaLabel="Open file dialog"
    >
      <section>
        <h2>Open flow</h2>
        <Dropzone
          busy={busy}
          errorMsg={errorMsg}
          setErrorMsg={setErrorMsg}
          openFile={openFile}
        />
      </section>
    </ModalDialog>
  );
}
