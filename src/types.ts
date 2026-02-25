// Minimal EPCIS 2.0-ish shapes (not full spec).

export type EpcisEventType = "ObjectEvent" | "AggregationEvent" | "TransformationEvent" | "AssociationEvent";

export type EpcisEvent = {
  type?: string; // often "ObjectEvent" etc in EPCIS 2.0 JSON/JSON-LD
  eventType?: string; // some producers use eventType
  eventTime?: string;
  eventTimeZoneOffset?: string;
  eventID?: string;
  action?: string;
  bizStep?: string;
  disposition?: string;
  readPoint?: { id?: string };
  bizLocation?: { id?: string };
  epcList?: string[];
  parentID?: string;
  childEPCs?: string[];
  inputEPCList?: string[];
  outputEPCList?: string[];
  transformationID?: string;
  bizTransactionList?: any;
  sourceList?: any;
  destinationList?: any;
  ilmd?: any;
  sensorElementList?: any;
  errorDeclaration?: any;
  [k: string]: any;
};

export type EpcisDocument = {
  '@context'?: any;
  type?: string;
  schemaVersion?: string;
  creationDate?: string;
  epcisBody?: any;
  eventList?: EpcisEvent[];
  [k: string]: any;
};

export type CaptureRequest = EpcisDocument | EpcisEvent[];
