declare module "multicast-dns" {
  type Question = {
    name: string;
    type: string;
  };

  type Answer = {
    name: string;
    type: string;
    data?: string | { target?: string; port?: number; priority?: number; weight?: number };
    port?: number;
  };

  type ResponsePacket = {
    answers: Answer[];
    additionals: Answer[];
  };

  type MdnsClient = {
    on(event: "response", listener: (packet: ResponsePacket) => void): void;
    query(input: { questions: Question[] }): void;
    destroy(): void;
  };

  export default function mdns(): MdnsClient;
}
