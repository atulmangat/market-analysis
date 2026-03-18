"""initial_schema

Revision ID: fdbc9170c3c9
Revises:
Create Date: 2026-03-18

Creates the full schema from scratch. On an existing DB this is a no-op
(tables already exist); on a fresh DB it creates everything.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'fdbc9170c3c9'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)
    existing = set(insp.get_table_names())

    if 'market_signals' not in existing:
        op.create_table('market_signals',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('symbol', sa.String(), nullable=True),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.Column('price', sa.Float(), nullable=True),
            sa.Column('volume', sa.BigInteger(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_market_signals_id', 'market_signals', ['id'])
        op.create_index('ix_market_signals_symbol', 'market_signals', ['symbol'])

    if 'agent_predictions' not in existing:
        op.create_table('agent_predictions',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.Column('symbol', sa.String(), nullable=True),
            sa.Column('agent_name', sa.String(), nullable=True),
            sa.Column('prediction', sa.String(), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('reasoning', sa.Text(), nullable=True),
            sa.Column('actual_outcome', sa.String(), nullable=True),
            sa.Column('score', sa.Float(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_agent_predictions_id', 'agent_predictions', ['id'])
        op.create_index('ix_agent_predictions_symbol', 'agent_predictions', ['symbol'])

    if 'deployed_strategies' not in existing:
        op.create_table('deployed_strategies',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.Column('symbol', sa.String(), nullable=True),
            sa.Column('strategy_type', sa.String(), nullable=True),
            sa.Column('entry_price', sa.Float(), nullable=True),
            sa.Column('reasoning_summary', sa.Text(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('current_return', sa.Float(), nullable=True),
            sa.Column('position_size', sa.Float(), nullable=True),
            sa.Column('exit_price', sa.Float(), nullable=True),
            sa.Column('realized_pnl', sa.Float(), nullable=True),
            sa.Column('close_reason', sa.String(), nullable=True),
            sa.Column('closed_at', sa.DateTime(), nullable=True),
            sa.Column('notes', sa.Text(), nullable=True),
            sa.Column('debate_round_id', sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_deployed_strategies_id', 'deployed_strategies', ['id'])
        op.create_index('ix_deployed_strategies_symbol', 'deployed_strategies', ['symbol'])
        op.create_index('ix_deployed_strategies_debate_round_id', 'deployed_strategies', ['debate_round_id'])

    if 'agent_prompts' not in existing:
        op.create_table('agent_prompts',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_name', sa.String(), nullable=True),
            sa.Column('description', sa.Text(), nullable=True),
            sa.Column('system_prompt', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_agent_prompts_id', 'agent_prompts', ['id'])
        op.create_index('ix_agent_prompts_agent_name', 'agent_prompts', ['agent_name'], unique=True)

    if 'market_config' not in existing:
        op.create_table('market_config',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('market_name', sa.String(), nullable=True),
            sa.Column('is_enabled', sa.Integer(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_market_config_id', 'market_config', ['id'])
        op.create_index('ix_market_config_market_name', 'market_config', ['market_name'], unique=True)

    if 'debate_rounds' not in existing:
        op.create_table('debate_rounds',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('timestamp', sa.DateTime(), nullable=True),
            sa.Column('consensus_ticker', sa.String(), nullable=True),
            sa.Column('consensus_action', sa.String(), nullable=True),
            sa.Column('consensus_votes', sa.String(), nullable=True),
            sa.Column('proposals_json', sa.Text(), nullable=True),
            sa.Column('enabled_markets', sa.String(), nullable=True),
            sa.Column('research_context', sa.Text(), nullable=True),
            sa.Column('judge_reasoning', sa.Text(), nullable=True),
            sa.Column('report_json', sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_debate_rounds_id', 'debate_rounds', ['id'])

    if 'app_config' not in existing:
        op.create_table('app_config',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('key', sa.String(), nullable=True),
            sa.Column('value', sa.String(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_app_config_id', 'app_config', ['id'])
        op.create_index('ix_app_config_key', 'app_config', ['key'], unique=True)

    if 'agent_memory' not in existing:
        op.create_table('agent_memory',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_name', sa.String(), nullable=True),
            sa.Column('note_type', sa.String(), nullable=True),
            sa.Column('content', sa.Text(), nullable=True),
            sa.Column('source_debate_id', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('importance_score', sa.Float(), nullable=True),
            sa.Column('ticker_refs', sa.String(), nullable=True),
            sa.Column('memory_layer', sa.String(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_agent_memory_id', 'agent_memory', ['id'])
        op.create_index('ix_agent_memory_agent_name', 'agent_memory', ['agent_name'])

    if 'web_research' not in existing:
        op.create_table('web_research',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('query', sa.String(), nullable=True),
            sa.Column('source_url', sa.String(), nullable=True),
            sa.Column('title', sa.String(), nullable=True),
            sa.Column('snippet', sa.Text(), nullable=True),
            sa.Column('fetched_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_web_research_id', 'web_research', ['id'])
        op.create_index('ix_web_research_query', 'web_research', ['query'])

    if 'agent_prompt_history' not in existing:
        op.create_table('agent_prompt_history',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('agent_name', sa.String(), nullable=True),
            sa.Column('generation', sa.Integer(), nullable=True),
            sa.Column('system_prompt', sa.Text(), nullable=True),
            sa.Column('fitness_score', sa.Float(), nullable=True),
            sa.Column('win_rate', sa.Float(), nullable=True),
            sa.Column('avg_return', sa.Float(), nullable=True),
            sa.Column('total_scored', sa.Integer(), nullable=True),
            sa.Column('evolution_reason', sa.String(), nullable=True),
            sa.Column('replaced_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_agent_prompt_history_id', 'agent_prompt_history', ['id'])
        op.create_index('ix_agent_prompt_history_agent_name', 'agent_prompt_history', ['agent_name'])

    if 'pipeline_runs' not in existing:
        op.create_table('pipeline_runs',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('run_id', sa.String(), nullable=True),
            sa.Column('run_type', sa.String(), nullable=True),
            sa.Column('step', sa.String(), nullable=True),
            sa.Column('shared_context', sa.Text(), nullable=True),
            sa.Column('proposals_json', sa.Text(), nullable=True),
            sa.Column('enabled_markets_json', sa.Text(), nullable=True),
            sa.Column('investment_focus', sa.String(), nullable=True),
            sa.Column('focus_tickers', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_pipeline_runs_id', 'pipeline_runs', ['id'])
        op.create_index('ix_pipeline_runs_run_id', 'pipeline_runs', ['run_id'], unique=True)

    if 'pipeline_events' not in existing:
        op.create_table('pipeline_events',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('run_id', sa.String(), nullable=True),
            sa.Column('run_type', sa.String(), nullable=True),
            sa.Column('step', sa.String(), nullable=True),
            sa.Column('agent_name', sa.String(), nullable=True),
            sa.Column('status', sa.String(), nullable=True),
            sa.Column('detail', sa.Text(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_pipeline_events_id', 'pipeline_events', ['id'])
        op.create_index('ix_pipeline_events_run_id', 'pipeline_events', ['run_id'])

    if 'kg_nodes' not in existing:
        op.create_table('kg_nodes',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('node_id', sa.String(), nullable=True),
            sa.Column('node_type', sa.String(), nullable=True),
            sa.Column('label', sa.String(), nullable=True),
            sa.Column('symbol', sa.String(), nullable=True),
            sa.Column('metadata_json', sa.Text(), nullable=True),
            sa.Column('last_seen_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_kg_nodes_id', 'kg_nodes', ['id'])
        op.create_index('ix_kg_nodes_node_id', 'kg_nodes', ['node_id'], unique=True)
        op.create_index('ix_kg_nodes_node_type', 'kg_nodes', ['node_type'])
        op.create_index('ix_kg_nodes_symbol', 'kg_nodes', ['symbol'])

    if 'kg_edges' not in existing:
        op.create_table('kg_edges',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('source_node_id', sa.String(), nullable=True),
            sa.Column('target_node_id', sa.String(), nullable=True),
            sa.Column('relation', sa.String(), nullable=True),
            sa.Column('confidence', sa.Float(), nullable=True),
            sa.Column('source_run_id', sa.String(), nullable=True),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_kg_edges_id', 'kg_edges', ['id'])
        op.create_index('ix_kg_edges_source_node_id', 'kg_edges', ['source_node_id'])
        op.create_index('ix_kg_edges_target_node_id', 'kg_edges', ['target_node_id'])
        op.create_index('ix_kg_edges_relation', 'kg_edges', ['relation'])
        op.create_index('ix_kg_edges_source_run_id', 'kg_edges', ['source_run_id'])

    if 'cache_entries' not in existing:
        op.create_table('cache_entries',
            sa.Column('key', sa.String(), nullable=False),
            sa.Column('value_json', sa.Text(), nullable=False),
            sa.Column('expires_at', sa.DateTime(), nullable=True),
            sa.Column('updated_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('key'),
        )
        op.create_index('ix_cache_entries_key', 'cache_entries', ['key'])

    if 'rss_feeds' not in existing:
        op.create_table('rss_feeds',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('url', sa.String(), nullable=True),
            sa.Column('label', sa.String(), nullable=True),
            sa.Column('market', sa.String(), nullable=True),
            sa.Column('is_enabled', sa.Integer(), nullable=True),
            sa.Column('is_builtin', sa.Integer(), nullable=True),
            sa.Column('created_at', sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index('ix_rss_feeds_id', 'rss_feeds', ['id'])
        op.create_index('ix_rss_feeds_url', 'rss_feeds', ['url'], unique=True)


def downgrade() -> None:
    for table in [
        'rss_feeds', 'cache_entries', 'kg_edges', 'kg_nodes',
        'pipeline_events', 'pipeline_runs', 'agent_prompt_history',
        'web_research', 'agent_memory', 'app_config', 'debate_rounds',
        'market_config', 'agent_prompts', 'deployed_strategies',
        'agent_predictions', 'market_signals',
    ]:
        op.drop_table(table)
