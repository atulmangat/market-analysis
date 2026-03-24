"""add_seen_articles

Revision ID: a1b2c3d4e5f6
Revises: fdbc9170c3c9
Create Date: 2026-03-24

Adds seen_articles table to deduplicate processed news articles.
"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa

revision: str = 'a1b2c3d4e5f6'
down_revision: Union[str, Sequence[str], None] = 'fdbc9170c3c9'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'seen_articles',
        sa.Column('id',            sa.Integer,  primary_key=True),
        sa.Column('title_key',     sa.String,   nullable=False, unique=True),
        sa.Column('source_domain', sa.String,   nullable=True),
        sa.Column('first_seen_at', sa.DateTime, nullable=True),
        sa.Column('expires_at',    sa.DateTime, nullable=True),
    )
    op.create_index('ix_seen_articles_id',            'seen_articles', ['id'])
    op.create_index('ix_seen_articles_title_key',     'seen_articles', ['title_key'], unique=True)
    op.create_index('ix_seen_articles_source_domain', 'seen_articles', ['source_domain'])
    op.create_index('ix_seen_articles_first_seen_at', 'seen_articles', ['first_seen_at'])
    op.create_index('ix_seen_articles_expires_at',    'seen_articles', ['expires_at'])


def downgrade() -> None:
    op.drop_table('seen_articles')
