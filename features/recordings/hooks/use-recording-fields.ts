// What the person types in the studio form: the details of the recording and the notation to attach. A draft being finished
// starts from what it already says.
import { useState } from "react";
import type { Group, Recording } from "../model";

export function useRecordingFields(draft: Recording | null, groups: Group[]) {
  const [title, setTitle] = useState(draft?.title || "");
  const [description, setDescription] = useState(draft?.description || "");
  const [groupId, setGroupId] = useState<number>(draft?.subgroup_id || groups[0]?.id || 0);
  const [recordingKind, setRecordingKind] = useState(draft?.recording_kind || "practice");
  const [raga, setRaga] = useState(draft?.raga || "");
  const [tala, setTala] = useState(draft?.tala || "");
  const [sruthi, setSruthi] = useState(draft?.sruthi || "");
  const [tempo, setTempo] = useState(draft?.tempo || "");
  const [notationText, setNotationText] = useState("");
  const [notationFile, setNotationFile] = useState<File | null>(null);
  return {
    title, setTitle, description, setDescription, groupId, setGroupId, recordingKind, setRecordingKind,
    raga, setRaga, tala, setTala, sruthi, setSruthi, tempo, setTempo,
    notationText, setNotationText, notationFile, setNotationFile,
  };
}

export type RecordingFields = ReturnType<typeof useRecordingFields>;
