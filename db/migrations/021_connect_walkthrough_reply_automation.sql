alter table connect_replies drop constraint if exists connect_replies_classification_check;

alter table connect_replies
  add constraint connect_replies_classification_check
  check (
    classification is null
    or classification = any (
      array[
        'INTERESTED'::text,
        'VIDEO_REQUESTED'::text,
        'OBJECTION'::text,
        'NOT_NOW'::text,
        'WRONG_CONTACT'::text,
        'UNSUBSCRIBE'::text,
        'OUT_OF_OFFICE'::text,
        'UNKNOWN'::text
      ]
    )
  );
