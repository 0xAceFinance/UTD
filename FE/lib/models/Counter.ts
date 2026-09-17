import { Schema, Document, model, models } from 'mongoose';

/**
 * Atomic sequence generator, one document per named sequence.
 *
 * Needed because deriving a pass number from `countDocuments() + 1` races: two
 * signups landing together both read the same count and both claim the same
 * number. `$inc` inside findOneAndUpdate is atomic on the server, so each
 * caller gets a distinct value.
 */
export interface ICounter extends Document {
    _id: string;
    seq: number;
}

const CounterSchema = new Schema<ICounter>({
    _id: { type: String, required: true },
    seq: { type: Number, required: true, default: 0 },
});

const Counter = models.Counter || model<ICounter>('Counter', CounterSchema);

/** Returns the next value in `name`, creating the sequence on first call. */
export async function nextSequence(name: string): Promise<number> {
    const doc = await Counter.findOneAndUpdate(
        { _id: name },
        { $inc: { seq: 1 } },
        { upsert: true, new: true },
    ).lean<{ seq: number } | null>();

    // upsert + new always returns the document; this keeps the caller honest if
    // a future driver change makes that untrue rather than handing back NaN.
    if (!doc) throw new Error(`Counter "${name}" returned no document`);

    return doc.seq;
}

export default Counter;
